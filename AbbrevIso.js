/**
 * AbbrevIso v1.1 JS lib for publication title abbreviation per ISO-4 standard.
 * Copyright (C) 2017 by Marcin Wrochna. MIT License, see file: LICENSE.
 * @fileoverview The library implements the method of abbreviating titles of
 * publications according to the ISO-4 standard. It also provides a way to list
 * matching patterns from the LTWA (List of Title Word Abbreviations).
 */
import * as collation from './collation.js';
import PrefixTree from './PrefixTree.js';


/**
 * A single pattern line from the LTWA.
 * @property {string} pattern - The actual pattern from the LTWA, with dashes.
 * @property {string} replacement - The replacement from the LTWA.
 * @property {Array<String>} languages - Languages to which this applies.
 *   (as ISO-639-2 (B) codes, e.g. 'mul' for multiple, 'und' for undefined).
 * @property {boolean} startDash - Does it have a starting dash?
 * @property {boolean} endDash - Does it have an ending dash?
 * @property {string} line - The original full line from the LTWA.
 */
export class LTWAPattern {
  /** @param {string} line A full tab-separated line from the LTWA CSV.*/
  constructor(line) {
    const a = line.split('\t');
    if (a.length != 3)
      throw new Error('Number of fields in LTWA line is not 3: "' + line + '"');

    this.line = line;
    let p = a[0].normalize('NFC').trim();
    // Some patterns include a disambiguation comment in parentheses, remove it.
    p = p.replace(/\(.*\)/, '').trim();
    this.pattern = p;
    if (p.length < 3)
      throw new Error('LTWA line has too short pattern: "' + line + '"');
    this.replacement = a[1].normalize('NFC').trim();
    if (['n.a.', 'n. a.', 'n.a'].includes(this.replacement))
      this.replacement = '–';
    this.languages = a[2].split(',').map(Function.prototype.call,
        String.prototype.trim);
    this.startDash = (p.charAt(0) == '-');
    this.endDash = (p.charAt(p.length - 1) == '-');
  }

  /**
   * Returns a string representation for easy sorting.
   * @return {string}
   */
  toString() {
    return '[object LTWAPattern: ' + this.line + ']';
  }
}

/**
 * The main class for finding LTWA matches and ISO-4 abbreviations.
 */
export class AbbrevIso {
  /**
   * @param {(string|Array<string>)} ltwa - The LTWA, tab-separated CSV format.
   * @param {(string|Array<string>)} shortWords - A list of short words
   *   (articles, prepositions, conjuctions) to be omitted from titles. Note
   *   that articles in a few languages are already hard-coded, as they are
   *   handled a bit differently by ISO-4 rules. 99.9% of English cases are
   *   handled by: in/to/of/on/a/an/the/into/as/for/from/with/and.
   */
  constructor(ltwa, shortWords) {
    /**
     * @private {!Array<LTWAPattern>}
     * Patterns not starting with a letter (all begin with ').
     */
    this.badPatterns_ = [];
    /**
     * @private {!PrefixTree<LTWAPattern>}
     * A prefix tree of patterns beginning with a dash.
     */
    this.nonprefixPatterns_ = new PrefixTree();
    /**
     * @private {!PrefixTree<LTWAPattern>}
     * A prefix tree of patterns not beginning with a dash.
     */
    this.dictPatterns_ = new PrefixTree();
    /**
     * @private The number of patterns added.
     */
    this.size_ = 0;

    // Add all patterns from ltwa as new `LTWAPattern`s.
    if (!(ltwa instanceof Array))
      ltwa = ltwa.split(collation.newlineRegex);
    let firstLine = true;
    for (const line of ltwa) {
      if (firstLine) { // Skip header.
        firstLine = false;
        continue;
      }
      if (line.trim().length == 0) // Skip empty lines.
        continue;
      this.addPattern(new LTWAPattern(line));
    }
    // Trim all shortWords.
    if (!(shortWords instanceof Array))
      shortWords = shortWords.split(collation.newlineRegex);
    this.shortWords_ = shortWords.map((s) => s.trim());
  }

  /** @return {number} Number of patterns added. */
  get size() {
    return this.size_;
  }

  /** @param {LTWAPattern} pattern */
  addPattern(pattern) {
    let p = pattern.pattern;
    p = p.replace(/^-/, '');
    p = p.replace(/-$/, '');
    p = collation.normalize(p);
    if (!/^[A-Za-z]/u.test(p))
      this.badPatterns_.push(pattern);
    p = collation.promiscuouslyNormalize(p);
    if (pattern.startDash)
      this.nonprefixPatterns_.add(p, pattern);
    else
      this.dictPatterns_.add(p, pattern);
    this.size_++;
  }

  /**
   * Returns any patterns that could potentially match `s` somewhere.
   * This returns around 5 times more patterns than actually match.
   * @param {string} s
   * @param {boolean} pretendDash - If true, pretend all patterns start
   *   and end with a dash (to find potential compound words)
   * @return {Array<LTWAPattern>}
   */
  getPotentialPatterns(s, pretendDash = false) {
    // Always add all bad patterns.
    let result = this.badPatterns_;
    s = collation.promiscuouslyNormalize(s);
    // Add dict-Patterns/nonprefix-Patterns potentially matching each position,
    // depending on whether this position starts a word or not.
    let isNewWord = true;
    for (let i = 0; i < s.length; i++) {
      if (s.charAt(i) == ' ') {
        isNewWord = true;
        continue;
      }
      if (isNewWord || pretendDash)
        result = result.concat(this.dictPatterns_.get(s.substr(i)));
      result = result.concat(this.nonprefixPatterns_.get(s.substr(i)));
      isNewWord = false;
    }
    // Remove duplicates in result.
    result.sort();
    result = result.filter((x, i, res) => !i || x !== res[i-1]);
    return result;
  }


  /**
   * Returns all matches of one given LTWAPattern in `value`.
   * We only call this function for patterns from `getPotentialPatterns`, so
   * we can do more expensive stuff here. Note that some overlapping matches and
   * abbreviations that would not strictly decrease the length (with the dot)
   * are returned, but should NOT be applied.
   * @param {string} value
   * @param {LTWAPattern} pattern
   * @param {?Array<string>} [languages=['*']] - Languages to consider when
   *     matching. Default '*' means languages are disregarded, otherwise we
   *     check intersection with `pattern.languages`: if empty, we return no
   *     matches (an empty array). Languages are listed as ISO-639-2 (B) codes,
   *     e.g. 'mul' for multiple, 'und' for undefined language.
   * @param {boolean} pretendDash - If true, pretend all patterns start and end
   *   with a dash (to find potential compound words)
   * @return {Array} An Array of `[i, iend, abbr, pattern]` Arrays, where the
   *     `pattern` matches `value[i..iend-1]`, `abbr` is the computed
   *     abbreviation that should be put in place of the match; it has
   *     capitalization, diacritics etc. preserved. `pattern` is the input
   *     LTWAPattern.
   */
  getPatternMatches(value, pattern, languages = ['*'], pretendDash = false) {
    // If a list of languages is given, check it intersects the pattern's list.
    if (languages !== undefined &&
        !languages.includes('*') &&
        !pattern.languages.some((x) => languages.includes(x)))
      return [];

    let replacement = pattern.replacement;
    if (replacement == '–')
      replacement = '';
    let p = pattern.pattern;
    if (pattern.startDash || pretendDash) {
      p = p.replace(/^-/, '');
      replacement = replacement.replace(/^-/, '');
    }
    if (pattern.endDash || pretendDash)
      p = p.replace(/-$/, '');
    replacement = Array.from(replacement);

    const result = [];
    let isPreviousCharBoundary = true;
    let i = 0;
    while (i < value.length) {
      if (!pattern.startDash && !pretendDash && !isPreviousCharBoundary) {
        isPreviousCharBoundary = collation.boundariesRegex.test(value[i]);
        i++;
        continue;
      }
      const r = collation.getCollatingMatch(value.substr(i), p);
      if (r === false) {
        isPreviousCharBoundary = collation.boundariesRegex.test(value[i]);
        i++;
        continue;
      }
      // Now pattern (ignoring dashes) has a match in `value`,
      // starting from i-th position.
      let abbr = '';
      let ii = 0;
      let iend = i + r[0][ii].length;
      for (let j = 0; j < replacement.length; j++) {
        if (replacement[j] == '.') {
          abbr += '.';
          continue;
        }
        // Omit value characters until we get to one
        // also present in the replacement.
        while (!collation.cEquiv(r[1][ii], replacement[j]) &&
            (j + 1 >= replacement.length ||
            !collation.cEquiv(r[1][ii], replacement[j] + replacement[j + 1]))) {
          ii++;
          iend += r[0][ii].length;
        }
        // If r[1][ii] is equivalent to two characters of the replacement,
        // we have to advance j twice.
        if (!collation.cEquiv(r[1][ii], replacement[j]))
          j++;
        // Now r[1][ii] is also present in the replacement,
        // so we copy it to abbr and move on to the next replacement character.
        abbr += r[0][ii];
        ii++;
        if (ii < r[0].length)
          iend += r[0][ii].length;
      }
      // We omit all remaining characters of the match
      // (with no counterpart in replacement).
      for (ii++; ii < r[0].length; ii++)
        iend += r[0][ii].length;
      // If the pattern had an ending dash,
      // omit all characters until we get a boundary.
      if (pattern.endDash || pretendDash) {
        while (iend < value.length &&
               !collation.boundariesRegex.test(value[iend]))
          iend++;
      // If the pattern had no ending dash, try to omit some characters due to
      // flection and if we don't have a boundary at iend, discard the pattern.
      } else {
        let valid = true;
        while (iend < value.length &&
               !collation.boundariesRegex.test(value[iend])) {
          if (/[iesn]/u.test(value[iend])) { // TODO better flection.
            iend++;
          } else {
            valid = false;
            break;
          }
        }
        if (!valid) {
          isPreviousCharBoundary = collation.boundariesRegex.test(value[i]);
          i++;
          continue;
        }
      }

      // If the replacement was 'n. a.' (not abbreviated), we make it so.
      if (replacement == '')
        abbr = value.substring(i, iend);
      // Report the match.
      result.push([i, iend, abbr, pattern]);

      i++;
      isPreviousCharBoundary = collation.boundariesRegex.test(value[i-1]);
    }

    return result;
  }

  /**
   * Returns all patterns matching `value`, sorted by start index of match.
   * Note this is not called by `makeAbbreviation`.
   * @param {string} value
   * @param {?Array<string>} languages - Only use patterns that apply to these.
   *     (as ISO-639-2 (B) codes, e.g. 'mul' for multiple, 'und' for undefined).
   * @param {boolean} pretendDash - If true, pretend all patterns start
   *   and end with a dash (to find potential compound words)
   * @param {?Array<LTWAPattern>} [patterns=getPotentialPatterns(value)]
   * @return {Array<LTWAPattern>}
   */
  getMatchingPatterns(value, languages = undefined,
      pretendDash = false, patterns = undefined) {
    if (patterns === undefined)
      patterns = this.getPotentialPatterns(value, pretendDash=pretendDash);
    value = value.normalize('NFC').trim();
    let matches = [];
    for (const pattern of patterns) {
      matches = matches.concat(
          this.getPatternMatches(value, pattern, languages, pretendDash)
      );
    }
    const getBeginning = ([i, _iend, _abbr, _pattern]) => i;
    matches.sort((a, b) => (getBeginning(a) - getBeginning(b)));
    return matches.map(([_i, _iend, _abbr, pattern]) => pattern);
  }

  /**
   * Compute an abbreviation according to all ISO-4 rules.
   * @param {string} value
   * @param {?Array<string>} languages - Only use patterns that apply to these.
   *     (as ISO-639-2 (B) codes, e.g. 'mul' for multiple, 'und' for undefined).
   * @param {?Array<LTWAPattern>} [patterns=getPotentialPatterns(value)]
   *     A list of potential patterns (you could give all, it's just damn slow).
   * @return {string}
   */
  makeAbbreviation(value, languages = undefined, patterns = undefined) {
    if (patterns === undefined)
      patterns = this.getPotentialPatterns(value);
    // Some basic lossless Unicode normalization.
    value = value.normalize('NFC').trim();
    // Punctuation:
    //     Remove ellipsis.
    value = value.replace(/\.\.\./ug, '');
    value = value.replace(/\u2026/ug, '');
    //     Remove commas.
    value = value.replace(/,/ug, '');
    //     Replace periods with commas, unless part of acronyms/initialisms,
    //     ordinals, or already abbreviated expressions.
    value = value.replace(/\./ug, ',');
    //    Return periods in acronyms (repeat for overlaps).
    value = value.replace(/((^|[A-Z,\.&\-\\\/])\s?[A-Z]),/ug, '$1.');
    value = value.replace(/((^|[A-Z,\.&\-\\\/])\s?[A-Z]),/ug, '$1.');
    //    Return periods in ordinals and common expressions.
    value = value.replace(/([\s\-:,&#()\\\/][0-9]{1,3}),/ug, '$1.');
    value = value.replace(/((^|\s)(St|Mr|Ms|Mrs|Mx|Dr|Prof|vs)),/ug, '$1.');
    value = value.replace(/^J,/ug, 'J.');
    //     (Standard says commas and periods for dependent titles can be
    //     preserved, but it doesn't seem to apply any such exceptions in
    //     examples).
    //     Omit '&' and '+' (when they stand for 'and'),
    //     unless part of names like AT&T.
    value = value.replace(/([^A-Z0-9])[&+]([^A-Z0-9])/ug, '$1$2');
    //     All other punctuation is preserved.

    // Omit generic terms separating dependent titles.
    const sTerms = ['Sect.', 'Ser.'];
    for (const term of sTerms)
      value = value.replace(term + ' ', '');

    // Capitalization is preserved.
    //     (First letter should be capitalized, but we leave that to local
    //     style, check e.g. 'tm-Technisches Messen').

    // Omit articles, prepositions, and conjunctions, unless first preposition
    // in title/subtitle, parts of names, meant as initialisms, 'A' meant as
    // 'Part A', national practice... Here I omit them only when preceded by a
    // boundary, succeeded by whitespace, and lower case or CamelCase (e.g. 'OR'
    // is preserved, since it may mean 'Operations Research', but 'B-A ' would
    // lose the 'A').

    // Articles, as opposed to other short words, are removed from the
    // beginning also, and are not preserved in single word titles.
    const articles = ['a', 'an', 'the', 'der', 'die', 'das', 'den', 'dem',
      'des', 'le', 'la', 'les', 'el', 'il', 'lo', 'los', 'de', 'het',
      'els', 'ses', 'es', 'gli', 'een', '\'t', '\'n'];
    for (const word of articles) {
      value = value.replace(new RegExp(
          '((^|' + collation.boundariesRegex.source + '))' + word + '\\s',
          'gu'), '$1');
      // Also try the word with the first letter capitalized.
      const cWord = word.charAt(0).toUpperCase() + word.trim().substr(1);
      value = value.replace(new RegExp(
          '((^|' + collation.boundariesRegex.source + '))' + cWord + '\\s',
          'gu'), '$1');
    }
    // French articles "l'", "d'" may be followed by whatever.
    value = value.replace(new RegExp(
        '((^|' + collation.boundariesRegex.source + '))(l|L|d|D)(\'|’)',
        'gu'), '$1');

    // We delay checking prepositions and conjunctions until a bit later, as
    // they are retained in 'single word' titles. If at the end we'd get a
    // single word, the current `value` will be returned. So further
    // modifications work on 'result' instead of `value`.
    let result = value;

    // Find and apply patterns, being careful about overlaps.
    let matches = []; // A list of [i, iend, startDash, endDash, abbr, line].
    for (const pattern of patterns) {
      matches = matches.concat(
          this.getPatternMatches(value, pattern, languages)
      );
    }
    // Sort by priority: patterns with fewer dashes first,
    // patterns with longer matches first, longer patterns first.
    const getPriority = ([i, iend, _abbr, pattern]) => (
      (pattern.startDash ? 100 : 0) +
      (pattern.endDash ? 100 : 0) - (iend - i) - pattern.pattern.length
    );
    matches.sort((a, b) => (getPriority(a) - getPriority(b)));
    // Resolve overlapping patterns according to priority.
    for (let j = 0; j < matches.length; ++j) {
      for (let k = j + 1; k < matches.length; ++k) {
        if (matches[j][1] > matches[k][0] && matches[k][1] > matches[j][0])
          matches.splice(k--, 1); // Remove the later one from matches.
      }
    }
    // Apply matches starting from the later ones.
    const getBeginning = ([i, _iend, _abbr, _pattern]) => i;
    matches.sort((a, b) => (getBeginning(b) - getBeginning(a)));
    for (const [i, iend, abbr, _pattern] of matches) {
      // If we'd abbreviate only one character or less (and add a dot),
      // we don't abbreviate at all.
      if (abbr.length < iend - i)
        result = result.substring(0, i) + abbr + result.substr(iend);
    }

    // Other short words are not removed from beginning
    for (const word of this.shortWords_) {
      if (word.trim().length != 0) {
        result = result.replace(new RegExp(
            '(' + collation.boundariesRegex.source + ')' + word.trim() + '\\s',
            'gu'), '$1');
        const cWord =
          word.trim().charAt(0).toUpperCase() + word.trim().substr(1);
        result = result.replace(new RegExp(
            '(' + collation.boundariesRegex.source + ')' + cWord + '\\s',
            'gu'), '$1');
      }
    }

    // Omit generic terms separating dependent titles.
    const terms = ['Series', 'Part', 'Section'];
    for (const term of terms)
      result = result.replace(' ' + term + ' ', ' ');

    // Remove superfluous whitepace.
    result = result.replace(/\s+/gu, ' ').trim();

    // Preserve single words.
    const r = new RegExp('.' + collation.boundariesRegex.source + '.', 'u');
    if (!(r.test(result)))
      return value;
    else
      return result;
  }
}
