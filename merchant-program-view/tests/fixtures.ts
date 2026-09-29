import type { Lookups, Ticket } from '../lib/types';

export function ticket(id: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    xyneId: id.toUpperCase(),
    title: `Ticket ${id}`,
    description: '',
    status: '',
    statusV2: 'TODO',
    priority: 'MEDIUM',
    stageName: 'Backlog',
    boardId: 'b1',
    projectId: 'p1',
    workspaceId: 'w1',
    userGroupId: '',
    channelId: 'c-board',
    conversationId: '',
    assignedTo: null,
    createdBy: 'u1',
    updatedBy: 'u1',
    ticketType: null,
    merchantId: null,
    eta: null,
    isArchived: false,
    kanbanPosition: null,
    closedAt: null,
    closedBy: null,
    statusUpdatedAt: 0,
    metadata: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as Ticket;
}

export const LOOKUPS: Lookups = {
  workspaceId: 'w1',
  deskChannels: new Map([['c-desk', 'Support Email']]),
  projects: new Map([
    ['p1', 'Euler'],
    ['p2', 'Payments'],
  ]),
  boards: new Map([
    ['b1', 'Issue'],
    ['b2', 'Core'],
  ]),
  users: new Map([['u9', 'Asha']]),
};

export function ticketMap(...rows: Ticket[]): Map<string, Ticket> {
  return new Map(rows.map(t => [t.id, t]));
}
