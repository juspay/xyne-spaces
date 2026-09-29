import { merchantBrief } from './agentBrief';
import { RANK } from './flags';
import type { FTicket } from './portfolio';
import { spaces } from './xyne';

/** Run the agent once and wait for its answer (nothing is saved to the user's chat history). */
async function ask(task: string, context: string): Promise<string> {
  const run = await spaces.claw.runAndWait({ agent: EXPLAIN_AGENT.slug, task, context, timeoutMs: 240_000 });
  if (run.error) throw new Error(run.error);
  if (!run.result) throw new Error(`${EXPLAIN_AGENT.name} finished without an answer (${run.status}).`);
  return run.result;
}

/** The Xyne agent that writes merchant summaries (see lib/agentBrief for what it's asked). */
export const EXPLAIN_AGENT = { slug: 'ticketmaster', name: 'Ticketmaster' };


/** Ask the agent for a short TL;DR of everything going on with one merchant (see merchantBrief). */
export async function summarizeMerchant(mid: string, tickets: FTicket[]): Promise<string> {
  const lines = tickets.map(t => {
    const top = [...t.flags].sort((a, b) => RANK[b.sev] - RANK[a.sev])[0];
    return {
      key: t.key,
      title: t.title,
      kind: t.kind === 'desk' ? ('Desk' as const) : ('Board' as const),
      stage: t.stage,
      open: t.open,
      age: t.d,
      idle: t.u,
      flag: top ? top.label : null,
      who: t.who,
    };
  });
  const { task, context } = merchantBrief(mid, lines);
  return ask(task, context);
}
