import type { SubTicket, SubTicketMapping, Ticket, TicketStatusV2 } from '@xyne/spaces-sdk';

export type { Ticket, TicketStatusV2 };

export type NodeKind = 'desk' | 'board';

export interface TicketNode {
  id: string;
  key: string;
  title: string;
  kind: NodeKind;
  /** "Desk · <channel>" or "<project> / <board>". */
  sourceLabel: string;
  projectId: string;
  boardId: string;
  channelId: string;
  /** Every MID on the ticket (column + merchant custom fields); empty when it has none. */
  merchantIds: string[];
  stageName: string;
  statusV2: TicketStatusV2;
  assigneeName: string | null;
  createdAt: number;
  updatedAt: number;
  url: string;
  chainId: string;
  hasParent: boolean;
  childCount: number;
}

export type ChainNode =
  | { type: 'ticket'; ticket: TicketNode; children: ChainNode[] }
  | { type: 'placeholder'; subTicketId: string; title: string }
  | { type: 'locked'; ticketId: string };

export interface Chain {
  /** Root ticket id. */
  id: string;
  root: ChainNode;
  /** Every ticket node in the chain, root first. */
  tickets: TicketNode[];
  mids: string[];
  origin: NodeKind;
  size: number;
  lastActivity: number;
  /** Nodes span more than one board, or Desk and a board. */
  crossesBoards: boolean;
}

/** Parent ticket → sub-ticket row → mapped child ticket (null = not linked yet). */
export interface Link {
  parentId: string;
  subTicketId: string;
  childId: string | null;
  subTitle: string;
  /** When the sub-ticket row was created (placeholder age). */
  subCreatedAt?: number;
}

export interface Lookups {
  workspaceId: string;
  /** The signed-in user (for "My merchants"). */
  meId: string;
  /** channelId → name, Desk channels only. */
  deskChannels: Map<string, string>;
  projects: Map<string, string>;
  boards: Map<string, string>;
  users: Map<string, string>;
}

export interface GraphInput {
  tickets: Map<string, Ticket>;
  links: Link[];
  lookups: Lookups;
  /** Resolved MIDs per ticket id (column + custom fields). Missing → parsed from the column. */
  mids?: Map<string, string[]>;
}

/** `listSubTicketsByMapped` rows carry their mappings at runtime; the SDK type omits them. */
export type SubTicketWithMappings = SubTicket & { ticketMappings?: SubTicketMapping[] };

export interface LoadWarning {
  key: string;
  message: string;
}

export interface LoadProgress {
  phase: 'boot' | 'tickets' | 'linking' | 'done';
  projectsDone: number;
  projectsTotal: number;
  desksDone: number;
  desksTotal: number;
}
