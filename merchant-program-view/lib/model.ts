import { buildChains, ticketUrl } from './graph';
import { parseMids } from './merchantFields';
import type { DataStore } from './load';
import type { ChainNode, Ticket } from './types';

/**
 * The redesign's view of a ticket: what kind it is, which merchants it counts under, who the
 * ball is with, and its age/update/ETA in days — derived from the loaded store and its chains.
 */

export type Kind = 'desk' | 'crm' | 'product';
export type Court = 'us' | 'merchant' | 'external';
export type Pri = 'critical' | 'high' | 'medium' | 'low' | 'none';
export type St = 'todo' | 'started' | 'paused' | 'completed' | 'cancelled';

export interface MTicket {
  id: string;
  key: string;
  title: string;
  kind: Kind;
  /** "Desk · <channel>" or "<project> / <board>". */
  src: string;
  stage: string;
  st: St;
  open: boolean;
  pri: Pri;
  court: Court;
  /** Assignee name, or null when unassigned. */
  who: string | null;
  /** Who created it; null when not a workspace user (e.g. an inbound email). */
  reporter: string | null;
  /** The ticket's own MIDs. */
  mids: string[];
  /** Own MIDs, else the chain's — the merchants this ticket counts under. */
  midR: string[];
  /** No MID of its own and none above it: its merchants come only from its sub-tickets, so it doesn't set their severity. */
  borrowed: boolean;
  /** Days since created / updated. */
  d: number;
  u: number;
  /** Days until the ticket ETA (negative once passed); null when unset. */
  eta: number | null;
  /** Server-computed: the current stage is past its ETA. */
  stageOverdue: boolean;
  createdAt: number;
  updatedAt: number;
  /** Days since closed; null while open. */
  closedD: number | null;
  parent: string | null;
  kids: string[];
  /** Sub-tickets with no linked ticket yet, with their age in days. */
  placeholders: { title: string; d: number }[];
  /** Chain root id. */
  root: string;
  url: string;
}

export interface Model {
  tickets: Map<string, MTicket>;
  /** MID → tickets counting under it. */
  byMid: Map<string, MTicket[]>;
  now: number;
}

const DAY = 86_400_000;
const days = (ms: number): number => Math.max(0, ms) / DAY;

const MERCHANT_STAGE = /waiting\s+on\s+(the\s+)?merchant|awaiting\s+merchant/i;
const EXTERNAL_STAGE = /on[\s-]*hold[\s-]*external|\bbank\b|\bpartner\b|\bnpci\b/i;

export function courtOf(stage: string | null | undefined): Court {
  const s = stage ?? '';
  if (MERCHANT_STAGE.test(s)) return 'merchant';
  if (EXTERNAL_STAGE.test(s)) return 'external';
  return 'us';
}

const PRI: Record<string, Pri> = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const ST: Record<string, St> = { TODO: 'todo', STARTED: 'started', PAUSED: 'paused', COMPLETED: 'completed', CANCELLED: 'cancelled' };

type Row = Ticket & { isStageOverdue?: boolean | null };

export function buildModel(store: DataStore, now: number): Model {
  const { lookups } = store;
  // Re-parse saved MIDs so placeholders from older loads ("Any", "NA") never become merchants.
  const midsById = new Map([...store.mids].map(([id, m]) => [id, parseMids(m)]));
  const chains = buildChains({ tickets: store.tickets, links: store.links, lookups, mids: midsById });
  const subAge = new Map(store.links.map(l => [l.subTicketId, l.subCreatedAt]));
  const tickets = new Map<string, MTicket>();

  const make = (t: Row, parent: string | null, root: string, chainMids: string[], aboveHasMids: boolean): MTicket => {
    const desk = lookups.deskChannels.has(t.channelId);
    const mids = midsById.get(t.id) ?? parseMids(t.merchantId);
    const st = ST[t.statusV2] ?? 'todo';
    const open = st !== 'completed' && st !== 'cancelled';
    // closedAt keeps the first close after a reopen; the latest status change is the latest close.
    const closedAt = open ? null : Math.max(t.closedAt ?? 0, t.statusUpdatedAt ?? 0) || t.updatedAt;
    return {
      id: t.id,
      key: t.xyneId,
      title: t.title,
      kind: desk ? 'desk' : mids.length > 0 ? 'crm' : 'product',
      src: desk
        ? `Desk · ${lookups.deskChannels.get(t.channelId)}`
        : `${lookups.projects.get(t.projectId) ?? 'Unknown project'} / ${lookups.boards.get(t.boardId) ?? 'Unknown board'}`,
      stage: t.stageName,
      st,
      open,
      pri: PRI[t.priority] ?? 'none',
      court: courtOf(t.stageName),
      who: t.assignedTo ? (lookups.users.get(t.assignedTo) ?? null) : null,
      reporter: lookups.users.get(t.createdBy) ?? null,
      mids,
      midR: mids.length > 0 ? mids : chainMids,
      borrowed: mids.length === 0 && !aboveHasMids,
      d: days(now - t.createdAt),
      u: days(now - t.updatedAt),
      eta: t.eta != null ? (t.eta - now) / DAY : null,
      stageOverdue: t.isStageOverdue === true,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      closedD: closedAt != null ? days(now - closedAt) : null,
      parent,
      kids: [],
      placeholders: [],
      root,
      url: ticketUrl(t, desk ? 'desk' : 'board', lookups.workspaceId),
    };
  };

  for (const chain of chains) {
    const walk = (node: ChainNode, parent: string | null, aboveHasMids: boolean): void => {
      if (node.type !== 'ticket') return;
      const row = store.tickets.get(node.ticket.id) as Row;
      const mt = make(row, parent, chain.id, chain.mids, aboveHasMids);
      tickets.set(mt.id, mt);
      for (const child of node.children) {
        if (child.type === 'ticket') {
          mt.kids.push(child.ticket.id);
          walk(child, mt.id, aboveHasMids || mt.mids.length > 0);
        } else if (child.type === 'placeholder') {
          const created = subAge.get(child.subTicketId);
          mt.placeholders.push({ title: child.title, d: created != null ? Math.floor(days(now - created)) : 0 });
        }
      }
    };
    walk(chain.root, null, false);
  }

  const byMid = new Map<string, MTicket[]>();
  for (const t of tickets.values()) {
    for (const mid of t.midR) {
      const list = byMid.get(mid);
      if (list) list.push(t);
      else byMid.set(mid, [t]);
    }
  }
  return { tickets, byMid, now };
}
