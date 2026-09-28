import type { TurnDebug, TurnInput, TurnResponse } from '@xyne/shared/assistant';

/**
 * The Diagnose log: what happened in each turn and how long it took, one line per event.
 * Local development only. Entries can contain user text; never send them to production logs.
 */

export const DIAGNOSTICS_ENABLED = import.meta.env.DEV;

/** Events kept; older ones drop off. */
const MAX_ENTRIES = 200;

export interface TraceEntry {
  id: number;
  at: Date;
  step: string;
  detail: string;
}

export function appendTrace(
  trace: readonly TraceEntry[],
  step: string,
  detail: string,
): TraceEntry[] {
  const id = (trace.at(-1)?.id ?? 0) + 1;
  return [...trace, { id, at: new Date(), step, detail }].slice(-MAX_ENTRIES);
}

export function describeInput(input: TurnInput): string {
  switch (input.kind) {
    case 'text':
      return `${input.via} “${input.text}”`;
    case 'choose':
      return `tapped ${input.optionId}`;
    case 'planResult':
      return `plan results: ${describeResults(input.results)}`;
  }
}

export function describeReply(response: TurnResponse): string {
  const parts = [
    response.say && `“${response.say}”`,
    response.display && `shows ${response.display.kind}`,
    response.run && `plan: ${response.run.plan.map(step => step.op).join(' → ')}`,
    response.expectsReply && 'waits for an answer',
    response.tone === 'error' && 'error',
  ];
  return parts.filter(Boolean).join(' · ') || 'nothing to say';
}

/** How Jev read the sentence: its kind, the likeliest actions, and whether it continued. */
export function describeDebug(debug: TurnDebug): string {
  const kind = Object.entries(debug.kind ?? {}).sort(([, left], [, right]) => right - left)[0];
  const parts = [
    kind && `kind ${kind[0]} ${kind[1].toFixed(2)}`,
    debug.actions?.length &&
      `actions ${debug.actions.map(({ action, probability }) => `${action} ${probability.toFixed(2)}`).join(', ')}`,
    debug.continues !== undefined && `continues ${debug.continues.toFixed(2)}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function describeResults(
  results: ReadonlyArray<{ ok: boolean; error?: string | undefined }>,
): string {
  return results.map(result => (result.ok ? 'ok' : `failed: ${result.error}`)).join(', ');
}

/** The whole log as text, for pasting into a bug report. */
export function formatTrace(trace: readonly TraceEntry[]): string {
  return trace
    .map(entry => `${entry.at.toISOString().slice(11, 23)}  ${entry.step}: ${entry.detail}`)
    .join('\n');
}
