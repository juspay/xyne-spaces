import type { TranscriptEntry } from '../../../stores/recordingStore';

/**
 * Formatted call transcript, shaped for the existing Ask AI context fields
 * (`pageSelection` / `attachedContext`) accepted by `XyneAIStreamManager.startStream`.
 *
 * This is the plug-in seam for in-call Ask AI: the transcript panel already holds the live
 * `TranscriptEntry[]` via `callTranscriptStore`; a future Ask AI tab calls this and passes
 * the result as context so the assistant can answer questions about the call. Exported and
 * intentionally unused for now — no AI UI ships in this iteration.
 */
export interface CallTranscriptContext {
  title: string;
  text: string;
}

/** `[mm:ss]` elapsed since the first line, so the model can anchor answers in time. */
function elapsedLabel(spokenAt: number, startedAt: number): string {
  const totalSeconds = Math.max(0, Math.round((spokenAt - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function buildCallTranscriptContext(
  transcripts: TranscriptEntry[],
  options?: { title?: string },
): CallTranscriptContext {
  const title = options?.title ?? 'Live call transcript';
  if (transcripts.length === 0) {
    return { title, text: '' };
  }

  const startedAt = transcripts[0]!.spokenAt;
  const text = transcripts
    .map(entry => `[${elapsedLabel(entry.spokenAt, startedAt)}] ${entry.speaker}: ${entry.text}`)
    .join('\n');

  return { title, text };
}
