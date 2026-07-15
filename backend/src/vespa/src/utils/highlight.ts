const getLevenshteinDistance = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j - 1] + cost,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j] + 1
      );
    }
  }
  return matrix[b.length][a.length];
};

/**
 * Check if two words match by dynamic prefix
 * Prefix length = Max(4, queryWordLength - 4)
 */
const isPrefixMatch = (queryWord: string, documentWord: string): boolean => {

   if (documentWord.startsWith(queryWord) && queryWord.length >= 4) {
    return true;
  }
  const prefixLength = Math.max(4 , Math.max(queryWord.length - 4, documentWord.length - 4));

  // Document word must be at least as long as the prefix
  if (documentWord.length < prefixLength) return false;
  
  const queryPrefix = queryWord.slice(0, prefixLength);
  const docPrefix = documentWord.slice(0, prefixLength);
  
  return queryPrefix === docPrefix;
};

export const highlightFuzzyText = (text: string, query: string): string => {
  if (!query || !text) return text;

  const queryWords = [...new Set(
    query.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2)
  )];

  if (queryWords.length === 0) return text;

  return text.split(/(\b)/).map((token) => {
    if (!/\w/.test(token)) return token;

    const lowerToken = token.toLowerCase();

    const isMatch = queryWords.some(qWord => {
      // 1. Exact match
      if (lowerToken === qWord) return true;
     const maxDist = qWord.length <= 6 ? 1 : 2;

      // 2. Fuzzy match (Levenshtein distance <= maxDist)
      if (Math.abs(lowerToken.length - qWord.length) <= maxDist) {
        if (getLevenshteinDistance(lowerToken, qWord) <= maxDist) {
          return true;
        }
      }

      if (isPrefixMatch(qWord, lowerToken)) {
        return true;
      }

      return false;
    });

    return isMatch ? `<hi>${token}</hi>` : token;
  }).join('');
};

/** Apply a transform only to text outside existing <hi>...</hi> spans, so passes never nest tags. */
const outsideHi = (text: string, fn: (segment: string) => string): string =>
  text.split(/(<hi>.*?<\/hi>)/gi).map(s => s.startsWith('<hi>') ? s : fn(s)).join('');

/**
 * Bold known mention display name(s) as one contiguous phrase (Slack-style, verbatim not
 * per-token), pulling an optional leading @/# sigil inside the highlight.
 */
export const highlightMentionNames = (text: string, names: string[]): string => {
  const uniq = [...new Set(names.map(n => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!text || !uniq.length) return text;
  // Word-boundary anchored so a name matches only as a whole token ("Test" must not bold
  // inside "Testing"); the lookbehind also rejects a word char before the @/# sigil.
  const alternation = uniq.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(?<![\\w@#])([@#]?(?:${alternation}))(?![\\w])`, 'gi');
  return outsideHi(text, s => s.replace(re, '<hi>$1</hi>'));
};

/**
 * Highlight a result field: exact mention-name phrases first (so the fuzzy pass can't fragment
 * a name), then fuzzy free-text — both outside existing <hi> spans. Skips fuzzy if already tagged.
 */
export const highlightText = (text: string, query: string, mentionNames: string[] = []): string => {
  let out = mentionNames.length ? highlightMentionNames(text, mentionNames) : text;
  if (!text.includes('<hi>')) out = outsideHi(out, s => highlightFuzzyText(s, query));
  return out;
};

/**
 * Calculate prefix boost score based on 3-letter prefix matching
 * Returns ratio of matched query prefixes (0.0 to 1.0)
 * 
 * @param text - Document text to analyze
 * @param query - Search query
 * @returns Boost score (0.0 to 1.0)
 */
export const calculatePrefixBoost = (text: string, query: string): number => {
    if (!text || !query) return 0;
    const queryWords = [...new Set(query.toLowerCase().split(/\s+/).filter(w => w.length >= 3))];
    if (queryWords.length === 0) return 0;
    const documentWords = [...new Set(text.toLowerCase().split(/\s+/).filter(w => w.length >= 3))];
    if (documentWords.length === 0) return 0;
    let totalBoost = 0;
    for (const qWord of queryWords) {
        let bestScore = 0;
        const maxDist = qWord.length <= 6 ? 1 : 2;
        for (const docWord of documentWords) {
            if (docWord === qWord) {
                bestScore = 1.0;
                break;
            }
            if (Math.abs(docWord.length - qWord.length) <= maxDist) {
                const distance = getLevenshteinDistance(docWord, qWord);
                if (distance <= maxDist) {
                    const score = distance === 1 ? 0.7 : 0.4;
                    bestScore = Math.max(bestScore, score);
                }
            }
            if (isPrefixMatch(qWord, docWord)) {
                bestScore += 0.3;
            }
        }
        totalBoost += bestScore;
    }
    return totalBoost / queryWords.length;
};
