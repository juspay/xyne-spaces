import { EMAIL_PREVIEW_MAX_CHARS } from '../constants';
import { stripHtml } from './strip-html';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Plain-text snippet for collapsed email rows. */
export function buildEmailPreview(
  body: string | null | undefined,
  maxLength = EMAIL_PREVIEW_MAX_CHARS,
): string {
  if (!body) return '';
  return stripHtml(body).replace(UUID_RE, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
