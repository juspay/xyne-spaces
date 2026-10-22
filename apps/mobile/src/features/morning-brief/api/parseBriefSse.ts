import type { DailyBriefPayload } from './dailyBriefApi';

export type BriefSseResult = {
  date?: string;
  content?: string;
  brief?: DailyBriefPayload;
  /** Set when the stream carried an `error` event and no `complete`. */
  error?: string;
  sawComplete: boolean;
};

/**
 * Parse a fully-buffered daily-brief regenerate SSE body.
 *
 * The stream frames are `event: <name>` + `data: <json>` pairs separated by
 * blank lines, with `:ka` comment keepalives every 15s. The mTLS transport
 * cannot stream, so the whole body arrives at once (same approach as
 * summarize-email-thread.ts) and we replay the frames here.
 */
export function parseBriefSse(raw: string): BriefSseResult {
  const result: BriefSseResult = { sawComplete: false };
  let eventType = '';

  const dispatch = (event: string, dataRaw: string): void => {
    let data: Record<string, unknown> = {};
    try {
      data = dataRaw ? (JSON.parse(dataRaw) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    const asString = (value: unknown, fallback = ''): string =>
      typeof value === 'string' ? value : fallback;

    if (event === 'start') {
      const date = asString(data['date']);
      if (date) result.date = date;
    } else if (event === 'complete') {
      result.sawComplete = true;
      result.content = asString(data['content']);
      const brief = data['brief'];
      if (brief && typeof brief === 'object') {
        result.brief = brief as DailyBriefPayload;
      }
      // A completed run supersedes any transient error frame that preceded it.
      delete result.error;
    } else if (event === 'error' && !result.sawComplete) {
      result.error = asString(data['message'], 'Regeneration failed');
    }
    // `progress` frames are ignored: with a buffered body they are stale by
    // the time we can read them.
  };

  // Multi-line payloads arrive as consecutive `data:` lines that must be
  // joined with '\n' before dispatch (SSE spec) — dispatching per line breaks
  // JSON.parse on any payload the server split, silently dropping it.
  let dataLines: string[] = [];
  const flush = (): void => {
    if (dataLines.length > 0) {
      dispatch(eventType || 'message', dataLines.join('\n'));
    }
    eventType = '';
    dataLines = [];
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.trim() === '') {
      // Blank line = end of one SSE event block.
      flush();
      continue;
    }
    if (rawLine.startsWith(':')) continue; // keepalive comment (":ka")
    if (rawLine.startsWith('event:')) {
      eventType = rawLine.slice('event:'.length).trim();
    } else if (rawLine.startsWith('data:')) {
      // Per spec only the single space after the colon is stripped; the rest
      // of the line is payload and must survive the '\n' join intact.
      dataLines.push(rawLine.slice('data:'.length).replace(/^ /, ''));
    }
  }
  flush(); // the last event may not be followed by a trailing blank line

  return result;
}
