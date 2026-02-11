import { compile } from 'html-to-text';

const convert = compile({
  wordwrap: false,
  selectors: [
    { selector: 'img', format: 'skip' },
    { selector: 'a', options: { noAnchorUrl: true } },
  ],
});

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
const HEADER_KEYS = new Set([
  'mime-version',
  'content-type',
  'dkim-signature',
  'feedback-id',
  'x-mailer',
  'user-agent',
]);

function extractImages(html: string): string[] {
  const images: string[] = [];
  if (!html) return images;

  const imgTagRegex = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgTagRegex.exec(html)) !== null) {
    const tag = match[0];
    const src = getAttr(tag, 'src') || getAttr(tag, 'data-src');
    if (src) images.push(src);
  }
  return images;
}

function extractImageUrlsFromText(text: string): string[] {
  const images: string[] = [];
  if (!text) return images;
  const urlRegex = /https?:\/\/[^\s\]\)">]+/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    let url = match[0].replace(/[),.;]+$/, '');
    if (IMAGE_EXT_RE.test(url)) images.push(url);
  }
  return images;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return null;
  return match[1] || match[2] || match[3] || null;
}

function stripBlockquoteMarkers(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n');
}

function stripKnownHtmlTags(text: string): string {
  if (!text) return '';
  return text.replace(
    /<\/?(br|p|div|span|meta|style|blockquote|table|thead|tbody|tr|td|th|li|ul|ol|pre|code|em|strong|img|a)\b[^>]*>/gi,
    ''
  );
}

function stripEmailHeaders(text: string, keys: Set<string>): string {
  if (!text) return '';
  const lines = text.split('\n');
  const out: string[] = [];
  let dropping = false;

  for (const line of lines) {
    if (dropping) {
      if (/^[ \t]/.test(line)) {
        continue;
      }
      dropping = false;
    }

    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim().toLowerCase();
      if (keys.has(key)) {
        dropping = true;
        continue;
      }
    }
    out.push(line);
  }

  return out.join('\n');
}

function extractBracketedUrls(text: string): { text: string; links: string[] } {
  const links: string[] = [];
  if (!text) return { text: '', links };

  const cleaned = text.replace(/\s*\[(https?:\/\/[^\]\s]+)\]/g, (_match, url) => {
    links.push(url);
    return '';
  });

  return { text: cleaned, links };
}

function unescapeEmbeddedJson(text: string): string {
  if (!text) return '';
  const count = (text.match(/\\"/g) || []).length;
  if (count < 5) return text;
  return text
    .replace(/\\\\r/g, '\r')
    .replace(/\\\\n/g, '\n')
    .replace(/\\\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function cleanTicketDescriptionHtml(rawHtml: string): { cleaned: string; images: string[] } {
  const descriptionHtml = typeof rawHtml === 'string' ? rawHtml : '';
  let descriptionClean = normalizeText(convert(descriptionHtml));
  descriptionClean = stripKnownHtmlTags(descriptionClean);
  descriptionClean = stripBlockquoteMarkers(descriptionClean);
  descriptionClean = stripEmailHeaders(descriptionClean, HEADER_KEYS);
  descriptionClean = stripKnownHtmlTags(descriptionClean);
  const bracketed = extractBracketedUrls(descriptionClean);
  descriptionClean = bracketed.text;
  descriptionClean = unescapeEmbeddedJson(descriptionClean);
  descriptionClean = normalizeText(descriptionClean);

  const descriptionImages = dedupe([
    ...extractImages(descriptionHtml),
    ...extractImageUrlsFromText(descriptionClean),
  ]);

  return { cleaned: descriptionClean, images: descriptionImages };
}
