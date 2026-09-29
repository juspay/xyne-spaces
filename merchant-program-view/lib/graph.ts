import { SPACES_WEB_URL } from './config';
import { parseMids } from './merchantFields';
import type {
  Chain,
  ChainNode,
  GraphInput,
  Link,
  Lookups,
  NodeKind,
  Ticket,
  TicketNode,
  TicketStatusV2,
} from './types';

export function normalizeMid(raw: string | null | undefined): string | null {
  const mid = raw?.trim() ?? '';
  return mid === '' ? null : mid;
}

export function isOpen(status: TicketStatusV2): boolean {
  return status !== 'COMPLETED' && status !== 'CANCELLED';
}

export function ticketUrl(t: Ticket, kind: NodeKind, workspaceId: string): string {
  return kind === 'desk'
    ? `${SPACES_WEB_URL}/${workspaceId}/support/${t.channelId}/${t.xyneId}`
    : `${SPACES_WEB_URL}/${workspaceId}/projects/${t.projectId}/${t.boardId}/${t.id}`;
}

function toNode(t: Ticket, lookups: Lookups, mids: string[]): TicketNode {
  const kind: NodeKind = lookups.deskChannels.has(t.channelId) ? 'desk' : 'board';
  const sourceLabel =
    kind === 'desk'
      ? `Desk · ${lookups.deskChannels.get(t.channelId)}`
      : `${lookups.projects.get(t.projectId) ?? 'Unknown project'} / ${lookups.boards.get(t.boardId) ?? 'Unknown board'}`;
  return {
    id: t.id,
    key: t.xyneId,
    title: t.title,
    kind,
    sourceLabel,
    projectId: t.projectId,
    boardId: t.boardId,
    channelId: t.channelId,
    merchantIds: mids,
    stageName: t.stageName,
    statusV2: t.statusV2,
    assigneeName: t.assignedTo ? (lookups.users.get(t.assignedTo) ?? null) : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    url: ticketUrl(t, kind, lookups.workspaceId),
    chainId: '',
    hasParent: false,
    childCount: 0,
  };
}

/** Children order: tickets oldest first, then placeholders, then locked nodes. */
function linkRank(l: Link, nodes: Map<string, TicketNode>): [number, number] {
  if (l.childId === null) return [1, 0];
  const child = nodes.get(l.childId);
  return child ? [0, child.createdAt] : [2, 0];
}

export function buildChains({ tickets, links, lookups, mids }: GraphInput): Chain[] {
  const nodes = new Map<string, TicketNode>();
  for (const t of tickets.values()) nodes.set(t.id, toNode(t, lookups, mids?.get(t.id) ?? parseMids(t.merchantId)));

  // One link per sub-ticket row; one parent per child; self-links ignored.
  const bySub = new Map<string, Link>();
  for (const l of links) if (nodes.has(l.parentId) && !bySub.has(l.subTicketId)) bySub.set(l.subTicketId, l);
  const outgoing = new Map<string, Link[]>();
  const parentOf = new Map<string, string>();
  for (const l of bySub.values()) {
    if (l.childId === l.parentId) continue;
    if (l.childId !== null && nodes.has(l.childId)) {
      if (parentOf.has(l.childId)) continue;
      parentOf.set(l.childId, l.parentId);
    }
    const list = outgoing.get(l.parentId) ?? [];
    list.push(l);
    outgoing.set(l.parentId, list);
  }

  const visited = new Set<string>();
  const build = (id: string, chainId: string, acc: TicketNode[], isRoot: boolean): ChainNode => {
    visited.add(id);
    const node = nodes.get(id)!;
    node.chainId = chainId;
    node.hasParent = !isRoot;
    acc.push(node);
    const out = [...(outgoing.get(id) ?? [])].sort((a, b) => {
      const [ra, ta] = linkRank(a, nodes);
      const [rb, tb] = linkRank(b, nodes);
      return ra - rb || ta - tb;
    });
    const children: ChainNode[] = [];
    for (const l of out) {
      if (l.childId === null) children.push({ type: 'placeholder', subTicketId: l.subTicketId, title: l.subTitle });
      else if (!nodes.has(l.childId)) children.push({ type: 'locked', ticketId: l.childId });
      else if (!visited.has(l.childId)) children.push(build(l.childId, chainId, acc, false));
    }
    node.childCount = children.length;
    return { type: 'ticket', ticket: node, children };
  };

  const chains: Chain[] = [];
  const makeChain = (rootId: string): void => {
    const acc: TicketNode[] = [];
    const root = build(rootId, rootId, acc, true);
    const chainMids = [...new Set(acc.flatMap(n => n.merchantIds))].sort();
    const sources = new Set(acc.map(n => (n.kind === 'desk' ? `desk:${n.channelId}` : `board:${n.boardId}`)));
    chains.push({
      id: rootId,
      root,
      tickets: acc,
      mids: chainMids,
      origin: nodes.get(rootId)!.kind,
      size: acc.length,
      lastActivity: Math.max(...acc.map(n => n.updatedAt)),
      crossesBoards: sources.size > 1,
    });
  };
  for (const id of nodes.keys()) if (!parentOf.has(id)) makeChain(id);
  // Whatever is left sits on a cycle: start a chain from it.
  for (const id of nodes.keys()) if (!visited.has(id)) makeChain(id);

  return chains
    .filter(c => c.mids.length > 0)
    .sort((a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
}
