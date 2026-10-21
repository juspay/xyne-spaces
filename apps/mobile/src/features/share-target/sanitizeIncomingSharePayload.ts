import type { IncomingSharePayload } from './nativeShareTarget';

/** Files.app / share-extension leftovers that must never become message text. */
export const isLocalFilePathShareText = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^file:/i.test(trimmed)) return true;
  // Absolute POSIX path (no scheme) — not a user caption.
  // Require a file-looking basename (has an extension) to avoid stripping
  // short slash-prefixed notes like "/cc team".
  if (
    trimmed.startsWith('/') &&
    !trimmed.includes('\n') &&
    !trimmed.includes(' ') &&
    /\.[A-Za-z0-9]{1,8}$/.test(trimmed)
  ) {
    return true;
  }
  return false;
};

/**
 * Drop local filesystem paths from shared text. iOS Share Extension used to
 * treat Files.app `file://` URLs as text before copying the real attachment.
 */
export const sanitizeIncomingSharePayload = (
  payload: IncomingSharePayload,
): IncomingSharePayload => {
  const text = payload.text?.trim() ?? '';
  if (!text) return payload;

  const kept = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isLocalFilePathShareText(line));

  const nextText = kept.length > 0 ? kept.join('\n') : null;
  if (nextText === (payload.text ?? null)) return payload;
  return { ...payload, text: nextText };
};
