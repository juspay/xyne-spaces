/** Up to two letters from the first two words of a name, "?" when there is none. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map(word => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
  return initials.length > 0 ? initials : '?';
}
