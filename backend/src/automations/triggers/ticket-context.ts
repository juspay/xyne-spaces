import { z } from 'zod';
import { ChannelType, EmailType, TicketPriority, TicketStatusV2 } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const TicketSchema = z.object({
  id: z.string(),
  xyneId: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  statusV2: z.nativeEnum(TicketStatusV2).nullable(),
  priority: z.nativeEnum(TicketPriority).nullable(),
  ticketType: z.string().nullable(),
  stageName: z.string().nullable(),
  boardId: z.string().nullable(),
  channelId: z.string().nullable(),
  conversationId: z.string().nullable(),
  projectId: z.string().nullable(),
  userGroupId: z.string().nullable(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  assignedTo: z.string().nullable(),
  closedAt: z.coerce.date().nullable(),
  closedBy: z.string().nullable(),
  eta: z.coerce.date().nullable(),
  merchantId: z.string().nullable(),
  isArchived: z.boolean().nullable(),
  aiCategory: z.string().nullable(),
  aiSubCategory: z.string().nullable(),
  referenceTicket: z.array(z.string()).nullable(),
  metadata: z.unknown().nullable(),
  lastEmailAt: z.coerce.date().nullable(),
  statusUpdatedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});

const BoardSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
});

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  code: z.string().nullable(),
});

const ChannelSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  type: z.string().nullable(),
});

const UserSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

const UserGroupSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
});

const LastEmailsSchema = z.object({
  lastReplyAt: z.coerce.date().nullable(),
  lastAgentReplyAt: z.coerce.date().nullable(),
  lastCustomerReplyAt: z.coerce.date().nullable(),
});

export const MembershipSchema = z.enum(['MEMBER', 'EXTERNAL']);
export type Membership = z.infer<typeof MembershipSchema>;

export async function getChannelMembership(
  channelId: string | null | undefined,
  userId: string | null | undefined,
): Promise<Membership> {
  if (!userId || !channelId) return 'MEMBER';
  const participant = await db.channelParticipant
    .findFirst({
      where: { channelId, userId },
      select: { id: true },
    })
    .catch(() => null);
  return participant ? 'MEMBER' : 'EXTERNAL';
}

export const TicketContextSchema = z.object({
  ticket: TicketSchema,
  board: BoardSchema.nullable(),
  project: ProjectSchema.nullable(),
  channel: ChannelSchema.nullable(),
  assignee: UserSummarySchema.nullable(),
  creator: UserSummarySchema.nullable(),
  group: UserGroupSchema.nullable(),
  lastEmails: LastEmailsSchema,
});

export type TicketContext = z.infer<typeof TicketContextSchema>;
type TicketRow = z.infer<typeof TicketSchema>;
type BoardRow = z.infer<typeof BoardSchema>;
type ProjectRow = z.infer<typeof ProjectSchema>;
type ChannelRow = z.infer<typeof ChannelSchema>;
type UserRow = z.infer<typeof UserSummarySchema>;
type GroupRow = z.infer<typeof UserGroupSchema>;

export interface TicketLike {
  id: string;
  xyneId?: string | null;
  title?: string | null;
  description?: string | null;
  statusV2?: TicketStatusV2 | null;
  priority?: TicketPriority | null;
  ticketType?: string | null;
  stageName?: string | null;
  boardId: string;
  channelId: string;
  conversationId?: string | null;
  projectId: string;
  workspaceId: string;
  userGroupId?: string | null;
  createdBy: string;
  updatedBy?: string | null;
  assignedTo?: string | null;
  closedAt?: Date | null;
  closedBy?: string | null;
  eta?: Date | null;
  merchantId?: string | null;
  isArchived?: boolean | null;
  aiCategory?: string | null;
  aiSubCategory?: string | null;
  referenceTicket?: readonly string[] | null;
  metadata?: unknown;
  lastEmailAt?: Date | null;
  statusUpdatedAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export async function buildTicketContext(ticket: TicketLike): Promise<TicketContext> {
  const lastEmails = await loadLastEmails(ticket);
  const [board, project, channel, assignee, creator, group] = await Promise.all([
    db.board
      .findUnique({ where: { id: ticket.boardId }, select: { id: true, name: true } })
      .catch(() => null),
    db.project
      .findUnique({
        where: { id: ticket.projectId },
        select: { id: true, name: true, code: true },
      })
      .catch(() => null),
    db.channel
      .findUnique({
        where: { id: ticket.channelId },
        select: { id: true, name: true, type: true },
      })
      .catch(() => null),
    ticket.assignedTo
      ? db.user
          .findUnique({
            where: { id: ticket.assignedTo },
            select: { id: true, name: true, email: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    db.user
      .findUnique({
        where: { id: ticket.createdBy },
        select: { id: true, name: true, email: true },
      })
      .catch(() => null),
    ticket.userGroupId
      ? db.userGroup
          .findUnique({
            where: { id: ticket.userGroupId },
            select: { id: true, name: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const ticketRow: TicketRow = {
    id: ticket.id,
    xyneId: ticket.xyneId ?? null,
    title: ticket.title ?? null,
    description: ticket.description ?? null,
    statusV2: ticket.statusV2 ?? null,
    priority: ticket.priority ?? null,
    ticketType: ticket.ticketType ?? null,
    stageName: ticket.stageName ?? null,
    boardId: ticket.boardId ?? null,
    channelId: ticket.channelId ?? null,
    conversationId: ticket.conversationId ?? null,
    projectId: ticket.projectId ?? null,
    userGroupId: ticket.userGroupId ?? null,
    createdBy: ticket.createdBy ?? null,
    updatedBy: ticket.updatedBy ?? null,
    assignedTo: ticket.assignedTo ?? null,
    closedAt: ticket.closedAt ?? null,
    closedBy: ticket.closedBy ?? null,
    eta: ticket.eta ?? null,
    merchantId: ticket.merchantId ?? null,
    isArchived: ticket.isArchived ?? null,
    aiCategory: ticket.aiCategory ?? null,
    aiSubCategory: ticket.aiSubCategory ?? null,
    referenceTicket: ticket.referenceTicket ? Array.from(ticket.referenceTicket) : null,
    metadata: ticket.metadata ?? null,
    lastEmailAt: ticket.lastEmailAt ?? null,
    statusUpdatedAt: ticket.statusUpdatedAt ?? null,
    createdAt: ticket.createdAt ?? null,
    updatedAt: ticket.updatedAt ?? null,
  };

  return {
    ticket: ticketRow,
    board: board ? ({ id: board.id, name: board.name ?? null } satisfies BoardRow) : null,
    project: project
      ? ({
          id: project.id,
          name: project.name ?? null,
          code: project.code ?? null,
        } satisfies ProjectRow)
      : null,
    channel: channel
      ? ({
          id: channel.id,
          name: channel.name ?? null,
          type: channel.type ?? null,
        } satisfies ChannelRow)
      : null,
    assignee: assignee
      ? ({
          id: assignee.id,
          name: assignee.name ?? null,
          email: assignee.email ?? null,
        } satisfies UserRow)
      : null,
    creator: creator
      ? ({
          id: creator.id,
          name: creator.name ?? null,
          email: creator.email ?? null,
        } satisfies UserRow)
      : null,
    group: group ? ({ id: group.id, name: group.name ?? null } satisfies GroupRow) : null,
    lastEmails,
  };
}

async function loadLastEmails(ticket: TicketLike): Promise<{
  lastReplyAt: Date | null;
  lastAgentReplyAt: Date | null;
  lastCustomerReplyAt: Date | null;
}> {
  const channel = await db.channel
    .findUnique({ where: { id: ticket.channelId }, select: { type: true } })
    .catch(() => null);
  if (!channel || channel.type !== ChannelType.EMAIL) {
    return { lastReplyAt: null, lastAgentReplyAt: null, lastCustomerReplyAt: null };
  }

  const ticketRow = await db.ticket
    .findUnique({ where: { id: ticket.id }, select: { conversationId: true } })
    .catch(() => null);
  const conversationId = ticketRow?.conversationId;
  if (!conversationId) {
    return { lastReplyAt: null, lastAgentReplyAt: null, lastCustomerReplyAt: null };
  }

  const preference = await db.emailChannelPreference
    .findUnique({ where: { channelId: ticket.channelId }, select: { sendAsEmail: true } })
    .catch(() => null);
  const channelAddress = preference?.sendAsEmail ?? null;
  const normalisedChannel = channelAddress ? channelAddress.toLowerCase() : null;

  const lastReply = await db.email
    .findFirst({
      where: {
        conversationId,
        type: { in: [EmailType.REPLY, EmailType.REPLY_ALL] },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, from: true },
    })
    .catch(() => null);

  let lastAgentReplyAt: Date | null = null;
  let lastCustomerReplyAt: Date | null = null;
  if (normalisedChannel) {
    const agent = await db.email
      .findFirst({
        where: {
          conversationId,
          type: { in: [EmailType.REPLY, EmailType.REPLY_ALL] },
          from: { contains: normalisedChannel, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      .catch(() => null);
    const customer = await db.email
      .findFirst({
        where: {
          conversationId,
          type: { in: [EmailType.REPLY, EmailType.REPLY_ALL] },
          NOT: { from: { contains: normalisedChannel, mode: 'insensitive' } },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      .catch(() => null);
    lastAgentReplyAt = agent?.createdAt ?? null;
    lastCustomerReplyAt = customer?.createdAt ?? null;
  }

  return {
    lastReplyAt: lastReply?.createdAt ?? null,
    lastAgentReplyAt,
    lastCustomerReplyAt,
  };
}

export interface TicketScopeFilter {
  boardIds?: readonly string[] | undefined;
  channelIds?: readonly string[] | undefined;
  projectIds?: readonly string[] | undefined;
}

export interface TicketScopeRow {
  boardId?: string | null | undefined;
  channelId?: string | null | undefined;
  projectId?: string | null | undefined;
}

export function matchTicketScopeFilters(
  cfg: TicketScopeFilter,
  ticket: TicketScopeRow | null | undefined,
): boolean {
  if (cfg.boardIds && cfg.boardIds.length > 0) {
    if (!ticket?.boardId || !cfg.boardIds.includes(ticket.boardId)) return false;
  }
  if (cfg.channelIds && cfg.channelIds.length > 0) {
    if (!ticket?.channelId || !cfg.channelIds.includes(ticket.channelId)) return false;
  }
  if (cfg.projectIds && cfg.projectIds.length > 0) {
    if (!ticket?.projectId || !cfg.projectIds.includes(ticket.projectId)) return false;
  }
  return true;
}

export async function hydrateTicketBoundPayload<P extends { ticketId: string }>(
  payload: P,
): Promise<P & Partial<TicketContext>> {
  const refreshed = await db.ticket
    .findUnique({ where: { id: payload.ticketId } })
    .catch(err => {
      logger.warn(
        `[ticket-context] hydrateTicketBoundPayload: findUnique threw for ticketId=${payload.ticketId}:`,
        err,
      );
      return null;
    });
  if (!refreshed) {
    logger.warn(
      `[ticket-context] hydrateTicketBoundPayload: ticket ${payload.ticketId} not found — returning payload WITHOUT ticket context (scope filters will treat ticket as absent)`,
    );
    return payload;
  }

  const context = await buildTicketContext(refreshed);
  logger.info(
    `[ticket-context] hydrateTicketBoundPayload: resolved ticket ${payload.ticketId} → channelId=${refreshed.channelId ?? '∅'} boardId=${refreshed.boardId ?? '∅'} projectId=${refreshed.projectId ?? '∅'}`,
  );
  return { ...payload, ...context };
}
