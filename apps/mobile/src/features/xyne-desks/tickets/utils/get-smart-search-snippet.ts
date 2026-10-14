/**
 * Truncates a Vespa mail snippet around the densest `<hi>` highlights.
 * Preserves `<hi>` tags so `buildSearchHighlightSegments` can render them.
 * DOM-free — safe for React Native.
 */
export function getSmartSearchSnippet(html: string, wordLimit = 40): string {
  if (!html) return '';

  const HI_OPEN = '\uE000';
  const HI_CLOSE = '\uE001';

  const normalized = html
    .replace(/<\s*hi\s*>/gi, HI_OPEN)
    .replace(/<\s*\/\s*hi\s*>/gi, HI_CLOSE)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, match => {
      const key = match.toLowerCase();
      if (key === '&amp;') return '&';
      if (key === '&lt;') return '<';
      if (key === '&gt;') return '>';
      if (key === '&quot;') return '"';
      if (key === '&#39;') return "'";
      if (key === '&nbsp;') return ' ';
      return match;
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  type WordToken = { text: string; highlighted: boolean };
  const words: WordToken[] = [];
  let highlighted = false;
  let buffer = '';

  const flush = (): void => {
    const text = buffer.trim();
    buffer = '';
    if (!text) return;
    for (const part of text.split(/\s+/)) {
      if (part) words.push({ text: part, highlighted });
    }
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;
    if (ch === HI_OPEN) {
      flush();
      highlighted = true;
      continue;
    }
    if (ch === HI_CLOSE) {
      flush();
      highlighted = false;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    buffer += ch;
  }
  flush();

  if (words.length === 0) return '';
  if (words.length <= wordLimit) {
    return tokensToHiHtml(words);
  }

  let currentScore = 0;
  for (let j = 0; j < wordLimit; j += 1) {
    if (words[j]?.highlighted) currentScore += 1;
  }

  let maxScore = currentScore;
  let bestStart = 0;

  for (let i = 1; i <= words.length - wordLimit; i += 1) {
    if (words[i - 1]?.highlighted) currentScore -= 1;
    if (words[i + wordLimit - 1]?.highlighted) currentScore += 1;
    if (currentScore > maxScore) {
      maxScore = currentScore;
      bestStart = i;
    }
  }

  const slice = words.slice(bestStart, bestStart + wordLimit);
  let result = tokensToHiHtml(slice);
  if (bestStart > 0) result = `... ${result}`;
  if (bestStart + wordLimit < words.length) result = `${result} ...`;
  return result;
}

function tokensToHiHtml(words: { text: string; highlighted: boolean }[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < words.length) {
    const word = words[i]!;
    if (!word.highlighted) {
      parts.push(word.text);
      i += 1;
      continue;
    }
    const hi: string[] = [];
    while (i < words.length && words[i]!.highlighted) {
      hi.push(words[i]!.text);
      i += 1;
    }
    parts.push(`<hi>${hi.join(' ')}</hi>`);
  }
  return parts.join(' ');
}
