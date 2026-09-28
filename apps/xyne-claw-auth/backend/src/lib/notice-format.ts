/**
 * Shared shaping for the deterministic notices claw posts into a thread.
 *
 * These are system messages, not agent output: /stop confirmations, queue
 * notices, sandbox announcements, failure reports. They accumulated
 * independently and drifted into a house style of leading emoji plus
 * dash-joined fragments —
 *
 *   🛑 Stopped 1 running run - cleaned 0 stale runs - dropped 0 queued messages.
 *
 * which reads as status-bar telemetry rather than something written for a
 * person, reports facts the reader did not ask for (two of those three counts
 * are zero), and at a glance looks like spam in a human conversation.
 *
 * House style for a notice:
 *   - No decorative emoji. A notice earns attention from what it says.
 *   - Open with a short bold lead naming the outcome, then a sentence.
 *   - State only what is true and non-zero. Silence beats "dropped 0 messages".
 *   - Prose over delimiter-joined fragments; a real list only when there
 *     genuinely are several independent items.
 */

/** Join clauses as prose: "a", "a and b", "a, b, and c". */
export function sentenceList(parts: readonly string[]): string {
  const items = parts.filter((part) => part.trim().length > 0);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** `1 run` / `2 runs` — count first, so the reader sees the number. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * A notice: bold lead, then the detail as a sentence. The lead is the part a
 * reader skimming the thread will actually take in, so it carries the outcome.
 */
export function notice(lead: string, detail?: string): string {
  const body = detail?.trim();
  return body ? `**${lead}** ${body}` : `**${lead}**`;
}
