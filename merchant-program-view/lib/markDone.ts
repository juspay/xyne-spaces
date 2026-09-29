import { closeMove, doneMove, type PanelStage, type PanelTransition } from './ticketPanel';
import { once } from './useTicketPanel';
import { spaces } from './xyne';

/** Where a ticket was before we moved it, so the move can be undone. */
export interface Prev {
  stageName: string;
  statusV2: string;
}

type Status = 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';

interface Loaded {
  id: string;
  stageName: string;
  statusV2: string;
  stages: PanelStage[];
  transitions: PanelTransition[];
  boardType: string | undefined;
}

async function load(ticketId: string): Promise<Loaded | null> {
  const t = (await spaces.tickets.getDetails(ticketId)) as unknown as { id: string; boardId: string; stageName: string; statusV2: string } | null;
  if (!t) return null;
  const b = t.boardId;
  const [stages, transitions, board] = await Promise.all([
    once(`stages:${b}`, () => spaces.boards.listStages(b)),
    once(`transitions:${b}`, () => spaces.boards.listTransitions(b)),
    once(`board:${b}`, () => spaces.boards.getDetail(b)),
  ]);
  return {
    id: t.id,
    stageName: t.stageName,
    statusV2: t.statusV2,
    stages: stages as unknown as PanelStage[],
    transitions: transitions as unknown as PanelTransition[],
    boardType: (board as unknown as { boardType?: string } | null)?.boardType,
  };
}

/**
 * Move one ticket to a terminal state the way the dashboard would: 'done' → Completed (see doneMove),
 * 'close' → the board's Cancelled stage, else Completed (see closeMove). Gated moves come back with
 * the reason; `to` names where it went.
 */
export async function markTerminal(ticketId: string, how: 'done' | 'close'): Promise<{ ok: true; prev: Prev | null; to: string } | { ok: false; reason: string }> {
  const t = await load(ticketId);
  if (!t) return { ok: false, reason: 'no longer available' };
  if (t.statusV2 === 'COMPLETED' || t.statusV2 === 'CANCELLED') return { ok: true, prev: null, to: t.stageName };
  const move = (how === 'done' ? doneMove : closeMove)(t.stageName, t.stages, t.transitions, t.boardType);
  if (move.kind === 'blocked') return { ok: false, reason: move.reason };
  if (move.kind === 'transition') await spaces.tickets.transitionStage(t.id, move.toStageName);
  else await spaces.tickets.update(t.id, move.data);
  const to = move.kind === 'transition' ? move.toStageName : move.data.stageName ?? (move.data.statusV2 === 'CANCELLED' ? 'Cancelled' : 'Completed');
  return { ok: true, prev: { stageName: t.stageName, statusV2: t.statusV2 }, to };
}

export async function markDone(ticketId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await markTerminal(ticketId, 'done');
  return r.ok ? { ok: true } : r;
}

/** Put a ticket back where it was (Undo). Non-linear boards only allow stage changes via a transition. */
export async function restoreTicket(ticketId: string, prev: Prev): Promise<void> {
  const t = await load(ticketId);
  if (!t) throw new Error('no longer available');
  if (t.boardType === 'NON_LINEAR' && t.stageName !== prev.stageName) {
    await spaces.tickets.transitionStage(t.id, prev.stageName);
    await spaces.tickets.update(t.id, { statusV2: prev.statusV2 as Status });
  } else {
    await spaces.tickets.update(t.id, { stageName: prev.stageName, statusV2: prev.statusV2 as Status });
  }
}
