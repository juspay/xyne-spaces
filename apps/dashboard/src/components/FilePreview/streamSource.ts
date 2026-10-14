import type { PreviewFile } from './types';

/** A path or url the api serves at, rather than an attachment id. */
export function isApiAddress(source: string): boolean {
  return source.startsWith('/') || /^https?:\/\//i.test(source);
}

/** The address a browser can fetch on its own for a file the api serves. */
export function browserAddressOf(source: string, apiBase: string): string | null {
  if (/^https?:\/\//i.test(source)) return source;
  if (!source.startsWith('/')) return null;
  return `${apiBase.replace(/\/+$/, '')}${source}`;
}

/**
 * The address a streaming previewer reads from: the one the file carries, and
 * this app's attachment service for a file held there by id.
 */
export function streamSourceOf(
  file: Pick<PreviewFile, 'id' | 'streamUrl'>,
  attachmentStreamUrl: (id: string) => string,
): string {
  return file.streamUrl ?? attachmentStreamUrl(file.id);
}
