// Compare git commit ids tolerating abbreviated SHAs (form values may be short):
// prefix-compare to the shorter id, requiring at least 7 chars.
export function isSameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = Math.min(a.length, b.length);
  if (n < 7) return false;
  return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}
