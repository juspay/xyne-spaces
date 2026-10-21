export interface AnswerLink {
  url: string;
  host: string;
  /** Why D would remove it: the host is not on the render allowlist, or the URL carries data while private data was read. */
  reason: "host_not_allowed" | "carries_data";
  /** An image or auto-loading element the browser fetches without a click. */
  autoLoads: boolean;
}

export interface AnswerCheck {
  links: AnswerLink[];
  /** The answer with the offending images and links reduced to their text; identical to the input when nothing was found. */
  text: string;
}

const MD_IMAGE = /!\[([^\]\n]{0,500})\]\(\s{0,3}<?(https?:\/\/[^\s)>]{1,2000})>?[^)\n]{0,200}\)/gi;
const HTML_IMAGE = /<(?:img|iframe|video|audio|source|embed)\b[^>\n]{0,500}?\bsrc\s{0,3}=\s{0,3}["']?(https?:\/\/[^\s"'>]{1,2000})[^>\n]{0,500}>/gi;
const MD_LINK = /\[([^\]\n]{0,500})\]\(\s{0,3}<?(https?:\/\/[^\s)>]{1,2000})>?[^)\n]{0,200}\)/gi;
const BARE_URL = /(?<![("'<\]])https?:\/\/[^\s)"'<>]{1,2000}/gi;

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function allowed(host: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((a) => {
    const h = a.toLowerCase();
    return host === h || host.endsWith(`.${h}`);
  });
}

function carriesData(url: string): boolean {
  try {
    const u = new URL(url);
    return u.search.length > 1 || u.pathname.length > 64;
  } catch {
    return false;
  }
}

/**
 * D, the output check: what a browser would fetch or what a link could carry out of the org. Pure; the
 * caller decides whether to show `text` (enforce) or only record `links` (shadow).
 */
export function checkAnswer(text: string, opts: { allowedHosts: readonly string[]; privateData: boolean }): AnswerCheck {
  const links: AnswerLink[] = [];
  const seen = new Set<string>();
  const consider = (url: string, autoLoads: boolean): boolean => {
    const host = hostOf(url);
    if (host === undefined) return false;
    const reason: AnswerLink["reason"] | undefined =
      autoLoads && !allowed(host, opts.allowedHosts) ? "host_not_allowed" : opts.privateData && carriesData(url) ? "carries_data" : undefined;
    if (reason === undefined) return false;
    if (!seen.has(url)) {
      seen.add(url);
      links.push({ url, host, reason, autoLoads });
    }
    return true;
  };
  let out = text.replace(MD_IMAGE, (m, alt: string, url: string) => (consider(url, true) ? alt || "[image removed]" : m));
  out = out.replace(HTML_IMAGE, (m, url: string) => (consider(url, true) ? "[image removed]" : m));
  out = out.replace(MD_LINK, (m, label: string, url: string) => (consider(url, false) ? label || "[link removed]" : m));
  out = out.replace(BARE_URL, (m) => (consider(m, false) ? "[link removed]" : m));
  return { links, text: links.length === 0 ? text : out };
}
