/**
 * Optimal Recognition Point (ORP) & RSVP timing engine.
 * Pure ES module with zero DOM dependencies so it can run in browsers and Node tests.
 */

const LEADING_PUNCT_RE = /^[^\p{L}\p{N}]+/u;
const TRAILING_PUNCT_RE = /[^\p{L}\p{N}]+$/u;
const SENTENCE_END_RE = /[.!?]["'”’)\]]*$/;
const CLAUSE_PAUSE_RE = /[,;:—–-]["'”’)\]]*$/;

/**
 * Compute the 0-based Optimal Recognition Point (ORP) character index within `word`.
 * Matches the standard RSVP/Spritz offset curve (~30% from the start of the core word):
 *   core length 1     -> index 0
 *   core length 2..5  -> index 1
 *   core length 6..9  -> index 2
 *   core length 10..13 -> index 3
 *   core length 14+   -> index 4
 *
 * Leading punctuation (e.g., quotes or parentheses) is skipped so the focal highlight
 * always lands on an actual letter or digit when one is present.
 *
 * @param {string} word
 * @returns {number}
 */
export function getOrpIndex(word) {
  if (!word || word.length <= 1) return 0;

  const leadingMatch = word.match(LEADING_PUNCT_RE);
  const leadingLen = leadingMatch ? leadingMatch[0].length : 0;
  const trailingMatch = word.match(TRAILING_PUNCT_RE);
  const trailingLen = trailingMatch ? trailingMatch[0].length : 0;

  // Core length excludes leading/trailing punctuation
  const coreLen = Math.max(0, word.length - leadingLen - trailingLen);

  // If the token is pure punctuation (e.g. "—"), highlight its center
  if (coreLen === 0) {
    return Math.floor((word.length - 1) / 2);
  }

  let offset;
  if (coreLen <= 1) offset = 0;
  else if (coreLen <= 5) offset = 1;
  else if (coreLen <= 9) offset = 2;
  else if (coreLen <= 13) offset = 3;
  else offset = 4;

  return Math.min(word.length - 1, leadingLen + offset);
}

/**
 * Split a single word into `{ left, orp, right, orpIndex }` for fixed-anchor rendering.
 *
 * @param {string} word
 * @returns {{ left: string, orp: string, right: string, orpIndex: number }}
 */
export function splitWordByOrp(word) {
  if (!word) {
    return { left: '', orp: '', right: '', orpIndex: 0 };
  }
  const chars = Array.from(word);
  // Map code-unit index safely via Array.from for surrogate pairs / Unicode
  const leadingMatch = word.match(LEADING_PUNCT_RE);
  const leadingChars = leadingMatch ? Array.from(leadingMatch[0]).length : 0;
  const trailingMatch = word.match(TRAILING_PUNCT_RE);
  const trailingChars = trailingMatch ? Array.from(trailingMatch[0]).length : 0;
  const coreLen = Math.max(0, chars.length - leadingChars - trailingChars);

  let orpIndex;
  if (coreLen === 0) {
    orpIndex = Math.floor((chars.length - 1) / 2);
  } else {
    let offset;
    if (coreLen <= 1) offset = 0;
    else if (coreLen <= 5) offset = 1;
    else if (coreLen <= 9) offset = 2;
    else if (coreLen <= 13) offset = 3;
    else offset = 4;
    orpIndex = Math.min(chars.length - 1, leadingChars + offset);
  }

  return {
    left: chars.slice(0, orpIndex).join(''),
    orp: chars[orpIndex] ?? '',
    right: chars.slice(orpIndex + 1).join(''),
    orpIndex,
  };
}

/**
 * Normalize whitespace and tokenize raw text into word tokens with paragraph metadata.
 * Hyphenated compounds longer than 14 characters are split after the hyphen so they
 * remain legible at high WPM.
 *
 * @param {string} text
 * @returns {Array<{ text: string, paragraphIndex: number, isParagraphEnd: boolean, isSentenceEnd: boolean }>}
 */
export function tokenizeText(text) {
  if (!text || typeof text !== 'string') return [];

  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Split into paragraphs on blank lines or single newlines with substantial breaks
  const rawParagraphs = normalized
    .split(/\n\s*\n+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const tokens = [];

  for (let pIdx = 0; pIdx < rawParagraphs.length; pIdx++) {
    const rawWords = rawParagraphs[pIdx]
      .replace(/([—–])(?=\S)/g, '$1 ')
      .replace(/(?<=\S)([—–])/g, ' $1')
      .split(/\s+/)
      .filter(Boolean);

    const expanded = [];
    for (const w of rawWords) {
      // Split very long hyphenated words into manageable visual chunks
      if (w.length > 15 && w.includes('-')) {
        const parts = w.split('-').filter(Boolean);
        if (parts.length > 1) {
          parts.forEach((part, idx) => {
            expanded.push(idx < parts.length - 1 ? `${part}-` : part);
          });
          continue;
        }
      }
      expanded.push(w);
    }

    for (let i = 0; i < expanded.length; i++) {
      const word = expanded[i];
      const isParagraphEnd = i === expanded.length - 1;
      const isSentenceEnd = isParagraphEnd || SENTENCE_END_RE.test(word);
      tokens.push({
        text: word,
        paragraphIndex: pIdx,
        isParagraphEnd,
        isSentenceEnd,
      });
    }
  }

  return tokens;
}

/**
 * Compute effective WPM at word `index` out of `totalWords`, supporting optional ramp mode.
 *
 * @param {object} options
 * @param {number} options.baseWpm
 * @param {boolean} options.rampEnabled
 * @param {number} options.rampStartWpm
 * @param {number} options.rampEndWpm
 * @param {number} options.index
 * @param {number} options.totalWords
 * @returns {number}
 */
export function getEffectiveWpm({
  baseWpm,
  rampEnabled = false,
  rampStartWpm = 300,
  rampEndWpm = 900,
  index = 0,
  totalWords = 1,
}) {
  if (!rampEnabled) {
    return clampWpm(baseWpm);
  }
  const denom = Math.max(1, totalWords - 1);
  const progress = Math.min(1, Math.max(0, index / denom));
  const interpolated = rampStartWpm + (rampEndWpm - rampStartWpm) * progress;
  return clampWpm(Math.round(interpolated));
}

export function clampWpm(wpm) {
  return Math.min(1500, Math.max(60, Math.round(Number(wpm) || 300)));
}

/**
 * Calculate display duration in milliseconds for a given token at `wpm`.
 *
 * @param {{ text: string, isParagraphEnd?: boolean, isSentenceEnd?: boolean }} token
 * @param {number} wpm
 * @param {boolean} smartPacing
 * @returns {number}
 */
export function getTokenDurationMs(token, wpm, smartPacing = true) {
  const baseMs = 60000 / clampWpm(wpm);
  if (!smartPacing || !token) {
    return baseMs;
  }

  const word = token.text || '';
  let multiplier = 1.0;

  if (token.isParagraphEnd) {
    multiplier = Math.max(multiplier, 2.0);
  } else if (SENTENCE_END_RE.test(word)) {
    multiplier = Math.max(multiplier, 1.75);
  } else if (CLAUSE_PAUSE_RE.test(word)) {
    multiplier = Math.max(multiplier, 1.35);
  }

  // Slight extra time for long words or numbers so comprehension stays crisp
  const cleanLen = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (cleanLen >= 13) {
    multiplier *= 1.25;
  } else if (cleanLen >= 9) {
    multiplier *= 1.12;
  }

  return baseMs * multiplier;
}

/**
 * Estimate remaining reading time in seconds from `currentIndex` to end.
 */
export function estimateRemainingSeconds(tokens, currentIndex, options) {
  if (!tokens || currentIndex >= tokens.length) return 0;
  let totalMs = 0;
  const totalWords = tokens.length;
  for (let i = currentIndex; i < totalWords; i++) {
    const wpm = getEffectiveWpm({
      ...options,
      index: i,
      totalWords,
    });
    totalMs += getTokenDurationMs(tokens[i], wpm, options.smartPacing);
  }
  return totalMs / 1000;
}

/**
 * Format seconds as `m:ss` or `h:mm:ss`.
 */
export function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(seconds || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Find the start index of the previous sentence relative to `currentIndex`.
 */
export function findPreviousSentenceIndex(tokens, currentIndex) {
  if (!tokens.length || currentIndex <= 0) return 0;
  // Step back at least 2 words so pressing it at the start of a sentence jumps to the one before
  let i = Math.max(0, currentIndex - 2);
  while (i > 0) {
    if (tokens[i - 1].isSentenceEnd || tokens[i - 1].isParagraphEnd) {
      return i;
    }
    i--;
  }
  return 0;
}

/**
 * Find the start index of the next sentence relative to `currentIndex`.
 */
export function findNextSentenceIndex(tokens, currentIndex) {
  if (!tokens.length) return 0;
  for (let i = currentIndex; i < tokens.length - 1; i++) {
    if (tokens[i].isSentenceEnd || tokens[i].isParagraphEnd) {
      return i + 1;
    }
  }
  return tokens.length - 1;
}
