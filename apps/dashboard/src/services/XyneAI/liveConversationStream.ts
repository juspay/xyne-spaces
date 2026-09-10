/**
 * Reader for claw's live conversation stream
 * (`GET /xyne-ai/v2/conversations/:convId/live`), shared by every surface that
 * watches a run it is not driving.
 *
 * This was extracted from `XyneAIStreamManager.attachLiveViewer`, which was the
 * only consumer until artifact apps needed to watch agent runs too. It is worth
 * having in one place because the details are not obvious and getting any of
 * them wrong fails quietly:
 *
 *  - the framing is named-event SSE (`event:` + one or more `data:` lines,
 *    flushed on a blank line), unlike the driving `/xyne-ai` stream, which is
 *    unnamed `data:`-only and parsed by the stream worker;
 *  - `: ping` heartbeats keep the connection alive through istio and must be
 *    skipped, not parsed;
 *  - a silent EOF is normal (proxy timeouts, pod rotation) and must be retried,
 *    because the server replays a Postgres snapshot on reconnect and heals the
 *    missed window — Redis pub/sub itself has no replay;
 *  - the retry budget resets whenever an event actually arrives, so a long,
 *    healthy run is never cut off by an early reconnect.
 *
 * `fetch` rather than axios because the browser needs a readable response body,
 * and rather than `EventSource` so this works identically everywhere without
 * depending on that API.
 */

import { BASE_URL } from '../clients/apiClient';

/** Silent EOFs to ride out before giving up. Reset on any received event. */
const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2000;

export interface LiveConversationStreamOptions {
  conversationId: string;
  agentSlug: string;
  /** Aborts the in-flight fetch. */
  signal: AbortSignal;
  /**
   * True once the caller considers the stream finished (typically on `done`).
   * Checked between reads so a terminal event stops the loop immediately rather
   * than after the next reconnect.
   */
  isClosed: () => boolean;
  onEvent: (event: string, data: Record<string, unknown>) => void;
  allRuns?: boolean;
}

/**
 * Consume the stream until it ends, the caller closes it, or the retry budget is
 * exhausted. Resolves either way — it never rejects, so callers can rely on
 * their own terminal handling rather than a catch block.
 *
 * Resolving does NOT mean the run finished: a caller that has not seen a `done`
 * must reconcile against the backend rather than assume completion.
 */
export async function consumeConversationLiveStream(
  options: LiveConversationStreamOptions,
): Promise<void> {
  const { conversationId, agentSlug, signal, isClosed, onEvent, allRuns } = options;
  let reconnects = 0;

  while (!isClosed() && !signal.aborted) {
    try {
      // SSE stream: must use fetch for a readable response body
      // (`res.body.getReader()`) — axios can't stream in the browser.
      const params = new URLSearchParams({ agentSlug });
      if (allRuns) params.set('allRuns', '1');
      // eslint-disable-next-line local-rules/no-fetch-use-axios
      const res = await fetch(
        `${BASE_URL}/xyne-ai/v2/conversations/${encodeURIComponent(conversationId)}/live?${params.toString()}`,
        {
          credentials: 'include',
          headers: { Accept: 'text/event-stream' },
          signal,
        },
      );

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';
        let dataLines: string[] = [];

        const flush = (): void => {
          if (currentEvent && dataLines.length > 0) {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
            } catch {
              parsed = {};
            }
            reconnects = 0; // events are flowing — reset the retry budget
            onEvent(currentEvent, parsed);
          }
          currentEvent = '';
          dataLines = [];
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done || isClosed()) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).replace(/\r$/, '');
            buffer = buffer.slice(nl + 1);
            if (line === '') {
              flush();
              continue;
            }
            if (line.startsWith(':')) continue; // heartbeat
            if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
          }
        }
      }
    } catch {
      /* aborted or network error — fall through to the retry decision */
    }

    if (isClosed() || signal.aborted) break;
    reconnects += 1;
    if (reconnects > MAX_RECONNECTS) break;
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
  }
}
