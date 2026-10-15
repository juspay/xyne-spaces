import type { TicketDetailsTabSnapshot } from '../types';

type TicketDetailsRowLike = {
  id: string;
  xyneId?: string | null | undefined;
  title?: string | null | undefined;
  description?: string | null | undefined;
  status?: string | null | undefined;
  statusV2?: string | null | undefined;
  stageName?: string | null | undefined;
  priority?: string | null | undefined;
  assignedTo?: string | null | undefined;
  createdBy?: string | null | undefined;
  eta?: number | null | undefined;
  boardName?: string | null | undefined;
  board?: { name?: string | null | undefined } | null | undefined;
  project?: { name?: string | null | undefined } | null | undefined;
  tagMappings?: ReadonlyArray<{ tagName?: string | null | undefined }> | null | undefined;
};

export function mapTicketDetailsTab(row: unknown): TicketDetailsTabSnapshot | null {
  if (row == null || typeof row !== 'object') return null;
  const ticket = row as TicketDetailsRowLike;
  if (!ticket.id) return null;

  const labels = (ticket.tagMappings ?? [])
    .map(t => t.tagName)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

  return {
    id: ticket.id,
    xyneId: (ticket.xyneId ?? '').trim() || ticket.id,
    title: (ticket.title ?? '').trim() || '(No subject)',
    description: ticket.description?.trim() || null,
    status: ticket.statusV2 ?? ticket.status ?? null,
    stageName: ticket.stageName ?? null,
    priority: ticket.priority ?? null,
    assignedTo: ticket.assignedTo ?? null,
    createdBy: ticket.createdBy ?? null,
    eta: typeof ticket.eta === 'number' ? ticket.eta : null,
    boardName: ticket.board?.name ?? ticket.boardName ?? null,
    projectName: ticket.project?.name ?? null,
    labels,
  };
}
