const MEET_URL = /^(?:https?:\/\/)?meet\.google\.com\/([a-z]+-[a-z]+-[a-z]+)\/?(?:[?#].*)?$/i;

/** Normalises a Google Meet link to `https://meet.google.com/<code>`, or null if it isn't one. */
export function parseMeetUrl(raw: string): { code: string; url: string } | null {
  const match = raw.trim().match(MEET_URL);
  if (!match?.[1]) return null;
  const code = match[1].toLowerCase();
  return { code, url: `https://meet.google.com/${code}` };
}
