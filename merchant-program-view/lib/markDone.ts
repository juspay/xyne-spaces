import { doneMove, type PanelStage, type PanelTransition } from './ticketPanel';
import { once } from './useTicketPanel';
import { spaces } from './xyne';

/** Mark one ticket done the way the dashboard would (see doneMove); gated moves come back with the reason. */
export async function markDone(ticketId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const t = (await spaces.tickets.getDetails(ticketId)) as unknown as { id: string; boardId: string; stageName: string; statusV2: string } | null;
  if (!t) return { ok: false, reason: 'no longer available' };
  if (t.statusV2 === 'COMPLETED') return { ok: true };
  const b = t.boardId;
  const [stages, transitions, board] = await Promise.all([
    once(`stages:${b}`, () => spaces.boards.listStages(b)),
    once(`transitions:${b}`, () => spaces.boards.listTransitions(b)),
    once(`board:${b}`, () => spaces.boards.getDetail(b)),
  ]);
  const boardType = (board as unknown as { boardType?: string } | null)?.boardType;
  const move = doneMove(t.stageName, stages as unknown as PanelStage[], transitions as unknown as PanelTransition[], boardType);
  if (move.kind === 'blocked') return { ok: false, reason: move.reason };
  if (move.kind === 'transition') await spaces.tickets.transitionStage(t.id, move.toStageName);
  else await spaces.tickets.update(t.id, move.data);
  return { ok: true };
}
