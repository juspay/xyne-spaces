/** The host of an address, for a label; empty when it has none. */
export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Where a typed address goes: a url as it is, something shaped like a host as
 * https (http for localhost and bare IPs), and anything else — words, a question —
 * to a search, as a browser's own bar does.
 */
export function addressFor(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const web = (candidate: string): string | null => {
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  };
  if (/^https?:\/\//i.test(text)) return web(text);
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]\S*)?$/i.test(text)) {
    return web(`http://${text}`);
  }
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(text)) return web(`https://${text}`);
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/** A typed home page as an address, or null for anything that isn't one — words
 *  would be a search, which is no place to start. */
export function homePageFor(typed: string): string | null {
  const text = typed.trim();
  if (!/^https?:\/\//i.test(text) && !/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(text)) {
    return null;
  }
  return addressFor(text);
}
