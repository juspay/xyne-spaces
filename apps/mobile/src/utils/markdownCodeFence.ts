function longestMarkerRun(value: string, marker: '`' | '~'): number {
  let longest = 0;
  let current = 0;

  for (const char of value) {
    if (char === marker) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

export function buildMarkdownCodeBlock(innerText: string, language = ''): string {
  const backtickLength = Math.max(3, longestMarkerRun(innerText, '`') + 1);
  const tildeLength = Math.max(3, longestMarkerRun(innerText, '~') + 1);
  const marker = backtickLength <= tildeLength ? '`' : '~';
  const fence = marker.repeat(marker === '`' ? backtickLength : tildeLength);
  const info = language.trim();

  return `\n\n${fence}${info}\n${innerText}\n${fence}\n\n`;
}
