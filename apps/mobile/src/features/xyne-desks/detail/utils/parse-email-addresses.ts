/** Coerce Zero JSON address fields into a clean string[]. */
export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

export function normalizeEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  const address = (match?.[1] ?? value).trim().toLowerCase();
  return address;
}

export function displayNameFromAddress(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match?.[1]) {
    return match[1].replace(/^["']|["']$/g, '').trim();
  }
  const address = trimmed.replace(/[<>]/g, '');
  return address.split('@')[0] || address;
}
