/**
 * What we send the agent to summarise a merchant: a read-only task and the merchant's tickets as
 * context, so the answer doesn't depend on the agent's own ticket access.
 */

/** One ticket, as a line of the merchant summary's context. */
export interface MerchantLine {
  key: string;
  title: string;
  kind: 'Desk' | 'Board';
  stage: string;
  open: boolean;
  /** Days since created. */
  age: number;
  /** Days since the last update. */
  idle: number;
  /** The ticket's most serious flag, if any. */
  flag: string | null;
  who: string | null;
}

const MAX_LINES = 60;

/** A TL;DR of everything going on with one merchant, for the box on its page. */
export function merchantBrief(mid: string, tickets: MerchantLine[]): { task: string; context: string } {
  const task = [
    `Write a TL;DR of what is happening with merchant ${mid}, for someone about to talk to them.`,
    'Use the ticket list below (and the tickets themselves, if you can read them).',
    'Keep it to 200-300 characters as 2-4 short bullet points, each starting with "- ".',
    'Bold (**like this**) the one or two things that matter most, e.g. a ticket key or a count. No heading, no preamble.',
    'This is read-only: do not change, comment on, or message anyone about any ticket.',
  ].join('\n');
  const d = (n: number): string => `${Math.floor(n)}d`;
  const ordered = [...tickets.filter(t => t.open).sort((a, b) => b.age - a.age), ...tickets.filter(t => !t.open)];
  const shown = ordered.slice(0, MAX_LINES).map(t =>
    t.open
      ? `- ${t.key} · ${t.title} · ${t.kind} · ${t.stage} · open ${d(t.age)} · no update ${d(t.idle)} · ${t.who ?? 'unassigned'}${t.flag ? ` · ${t.flag}` : ''}`
      : `- ${t.key} · ${t.title} · ${t.kind} · ${t.stage} · closed`,
  );
  const more = ordered.length - shown.length;
  const head = `${mid}: ${tickets.length} tickets, ${tickets.filter(t => t.open).length} open`;
  return { task, context: [head, ...shown, ...(more > 0 ? [`(${more} more tickets left out)`] : [])].join('\n') };
}
