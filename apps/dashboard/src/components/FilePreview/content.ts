import { useCallback, useEffect, useState } from 'react';
import { fetchFile } from '../../services/clients/fileFetchService';
import type { PreviewFile, Previewer } from './types';

export type PreviewContentState =
  | { status: 'loading' }
  /** The server is still making what the preview shows (an HEIC photo's WebP, and
   *  later a document's PDF): asked again shortly. */
  | { status: 'preparing' }
  | { status: 'ready'; content: File | null }
  | { status: 'failed' };

/** How long to keep asking after a rendition the server is still making: about a minute. */
const PREPARING_ATTEMPTS = 30;
const PREPARING_RETRY_MS = 2000;

/**
 * The server answers 503 for a rendition its worker hasn't finished: the contract
 * the HEIC WebP uses, and the one document previews will. The api client hands
 * errors on as plain Errors carrying only `status` — its Retry-After doesn't come
 * through — so the wait is the server's usual two seconds.
 */
function preparingDelay(error: unknown): number | null {
  const preparing =
    typeof error === 'object' && error !== null && 'status' in error && error.status === 503;
  return preparing ? PREPARING_RETRY_MS : null;
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The file's bytes for a previewer that reads them whole, fetched by the attachment's
 * id so the api base the app runs under applies (the SDLC lane's included). Cached
 * across tabs by the fetch service. A previewer that streams gets no bytes, at once.
 */
export function usePreviewContent(
  file: PreviewFile,
  previewer: Previewer | null,
): { state: PreviewContentState; retry: () => void } {
  const [state, setState] = useState<PreviewContentState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const source =
    previewer?.reads.kind === 'file' ? (previewer.reads.source?.(file) ?? file.id) : null;

  useEffect(() => {
    if (!previewer) return;
    if (source === null) {
      setState({ status: 'ready', content: null });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      for (let tries = 0; tries < PREPARING_ATTEMPTS; tries += 1) {
        try {
          const content = await fetchFile(source, file.name, file.mimetype);
          if (!cancelled) setState({ status: 'ready', content });
          return;
        } catch (error) {
          const delay = preparingDelay(error);
          if (delay === null) break;
          if (cancelled) return;
          setState({ status: 'preparing' });
          await wait(delay);
          if (cancelled) return;
        }
      }
      if (!cancelled) setState({ status: 'failed' });
    })();
    return () => {
      cancelled = true;
    };
  }, [previewer, source, file.name, file.mimetype, attempt]);

  const retry = useCallback(() => setAttempt(current => current + 1), []);
  return { state, retry };
}

/** A previewer's reading of its bytes as text, which is asynchronous. */
export function useFileText(content: File | null): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!content) return;
    let cancelled = false;
    setText(null);
    void content.text().then(value => {
      if (!cancelled) setText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [content]);
  return text;
}
