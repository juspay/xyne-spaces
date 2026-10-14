export function firstKnownReleaseValue(...values: readonly string[]): string {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== 'unknown') {
      return trimmed;
    }
  }

  return '';
}
