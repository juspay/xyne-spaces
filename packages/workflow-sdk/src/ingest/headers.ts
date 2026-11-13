/** First value of a header, matched case-insensitively. */
export function headerValue(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}
