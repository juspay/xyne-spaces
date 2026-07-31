import { callService } from '../../../services/Call/callService';

// Shared highlight for the cited transcript line — used by BOTH the hover preview
// and the full modal so they stay in sync. Soft blue (not yellow). Lives in a
// className string (never runtime classList.add) so Tailwind reliably generates it.
export const CITATION_HIGHLIGHT =
  'border-l-2 border-orange-400 bg-orange-50/80 text-foreground ring-1 ring-inset ring-orange-200/80 dark:border-orange-300 dark:bg-orange-400/10 dark:ring-orange-400/30';

// Shared transcript fetch + parse used by BOTH the transcript hover-card
// (CanvasCitationSpec) and the full transcript modal (TranscriptCitationModal).
// Keeping one parser here guarantees the two surfaces number segments the SAME
// way the backend does (numberTranscriptSegments in callDocumentService.ts),
// so a `[clf-N]` citation resolves to the identical line everywhere.

// Matches the backend TRANSCRIPT_LINE_RE exactly: "[MM:SS] Speaker: text"
// (leading whitespace tolerated — a reflow/translation pass can indent a line).
// Only lines matching this are numbered, so the Nth match here === segment N
// the backend emitted.
export const TRANSCRIPT_LINE_RE = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+?):\s*([\s\S]*)$/;

export interface TranscriptLine {
  raw: string;
  timestamp: string | null;
  speaker: string | null;
  text: string | null;
  /** 1-based index among timestamped lines — matches the backend segment id. */
  segment: number | null;
}

export function parseTranscript(text: string): TranscriptLine[] {
  let seg = 0;
  return text
    .split('\n')
    .filter(l => l.length > 0)
    .map(raw => {
      const m = raw.match(TRANSCRIPT_LINE_RE);
      if (m) {
        seg += 1;
        // Groups 1–3 are mandatory in the regex, so a match guarantees them.
        return { raw, timestamp: m[1]!, speaker: m[2]!, text: m[3]!, segment: seg };
      }
      return { raw, timestamp: null, speaker: null, text: null, segment: null };
    });
}

// In-memory cache keyed by callId. A canvas can hold dozens of citation chips
// pointing at the SAME call; hovering several of them (or hovering then clicking
// to open the modal) must not refetch the transcript each time. A rejected fetch
// is evicted so a later hover/open can retry.
const cache = new Map<string, Promise<string>>();

export function fetchTranscriptCached(callId: string): Promise<string> {
  let p = cache.get(callId);
  if (!p) {
    p = callService.downloadTranscript(callId).then(res => res.data ?? '');
    p.catch(() => cache.delete(callId));
    cache.set(callId, p);
  }
  return p;
}

/** Resolve the line index for a citation: prefer the stable segment number
 *  (precise even when timestamps repeat), fall back to the timestamp. */
export function findTargetIndex(
  lines: TranscriptLine[],
  segment: string | number | undefined,
  timestamp: string | undefined,
): number {
  const segNum = segment !== undefined && segment !== '' ? Number(segment) : NaN;
  if (Number.isFinite(segNum)) {
    const bySeg = lines.findIndex(l => l.segment === segNum);
    if (bySeg >= 0) return bySeg;
  }
  if (timestamp) return lines.findIndex(l => l.timestamp === timestamp);
  return -1;
}
