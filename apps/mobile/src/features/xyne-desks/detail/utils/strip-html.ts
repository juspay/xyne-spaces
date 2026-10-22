import { decodeEntitySet } from '@/src/utils/htmlText';

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', '#39': "'", quot: '"' };

/** RN-safe HTML → plain text (no DOM). */
export function stripHtml(html: string): string {
  if (!html) return '';
  const withoutTags = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script(?:\s[^>]*)?>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntitySet(withoutTags, ENTITIES)
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
