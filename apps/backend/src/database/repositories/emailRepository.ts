import { DatabaseClient } from '../client';
import { Email, Prisma } from '@prisma/client';
import { EmailType } from '@xyne/shared';
import { withWorkspaceScope } from '../tenant/context';
import { syncTicketEmailCount } from '../syncTicketEmailCount';
import { normalizeRfcMessageId, normalizeRfcMessageIds } from '@/utils/emailRfcMessageId';

export interface CreateEmailData {
  type: EmailType;
  subject: string;
  body: string;
  to: string[];
  from: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  conversationId: string;
  channelId: string;
  externalThreadId: string;
  externalMessageId: string;
  sentByUserId?: string;
  rfcMessageId?: string | null;
  rating?: number;
  clientVersionName?: string;
  clientVersionCode?: string;
  createdAt?: Date;
}

export class EmailRepository {
  private db = DatabaseClient.getInstance();

  async create(
    data: CreateEmailData,
    tx?: Prisma.TransactionClient,
    options?: { workspaceId?: string },
  ): Promise<Email> {
    const db = tx ?? this.db;
    const row = await this.buildEmailRow(data, tx, options?.workspaceId);
    const email = await db.email.upsert({
      where: {
        externalMessageId_channelId: {
          externalMessageId: data.externalMessageId,
          channelId: data.channelId,
        },
      },
      update: {},
      create: row,
    });
    await this.afterEmailInsert(data, tx);
    return email;
  }

  /** Insert-only create(): `created` is false when a concurrent ingest stored this message first. */
  async createIfAbsent(data: CreateEmailData): Promise<{ email: Email; created: boolean }> {
    const row = await this.buildEmailRow(data);
    let email: Email;
    try {
      email = await this.db.email.create({ data: row });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      const existing = await this.findByExternalMessageIdAndChannel(data.externalMessageId, data.channelId);
      if (!existing) throw error;
      return { email: existing, created: false };
    }
    await this.afterEmailInsert(data);
    return { email, created: true };
  }

  private async buildEmailRow(
    data: CreateEmailData,
    tx?: Prisma.TransactionClient,
    knownWorkspaceId?: string,
  ): Promise<Prisma.EmailUncheckedCreateInput> {
    const db = tx ?? this.db;
    const rfcMessageId = normalizeRfcMessageId(data.rfcMessageId);
    const workspaceId = knownWorkspaceId ?? (await db.channel.findUnique({
      where: { id: data.channelId },
      select: { workspaceId: true },
    }))?.workspaceId;
    if (!workspaceId) {
      throw new Error(`Could not find workspaceId for channel ${data.channelId}`);
    }
    return {
      type: data.type,
      workspaceId,
      subject: data.subject,
      body: data.body,
      to: data.to,
      from: data.from,
      cc: data.cc || [],
      bcc: data.bcc || [],
      replyTo: data.replyTo || [],
      conversationId: data.conversationId,
      channelId: data.channelId,
      externalThreadId: data.externalThreadId,
      externalMessageId: data.externalMessageId,
      ...(data.sentByUserId && { sentByUserId: data.sentByUserId }),
      ...(rfcMessageId && { rfcMessageId }),
      ...(data.rating != null && { rating: data.rating }),
      ...(data.clientVersionName && { clientVersionName: data.clientVersionName }),
      ...(data.clientVersionCode && { clientVersionCode: data.clientVersionCode }),
      ...(data.createdAt && { createdAt: data.createdAt }),
    };
  }

  private async afterEmailInsert(data: CreateEmailData, tx?: Prisma.TransactionClient): Promise<void> {
    const rfcMessageId = normalizeRfcMessageId(data.rfcMessageId);
    if (rfcMessageId) {
      await this.backfillRfcMessageIdByExternalMessageId(
        data.channelId,
        data.externalMessageId,
        rfcMessageId,
        tx,
      );
    }
    await syncTicketEmailCount(tx ?? this.db, data.conversationId);
  }

  async findById(id: string): Promise<Email | null> {
    return await this.db.email.findUnique({
      where: { id },
    });
  }

  async findByExternalMessageIdAndChannel(
    externalMessageId: string,
    channelId: string,
  ): Promise<Email | null> {
    return await this.db.email.findUnique({
      where: {
        externalMessageId_channelId: {
          externalMessageId,
          channelId,
        },
      },
    });
  }

  async findExistingExternalMessageIds(
    externalMessageIds: string[],
    channelId: string,
  ): Promise<string[]> {
    if (externalMessageIds.length === 0) return [];
    // Ingestion dedupe: keyed on the target channel, not on the triggering user.
    const emails = await withWorkspaceScope(() =>
      this.db.email.findMany({
        where: {
          externalMessageId: { in: externalMessageIds },
          channelId,
        },
        select: { externalMessageId: true },
      }),
    );
    return emails.map(e => e.externalMessageId);
  }

  async findByConversationId(conversationId: string): Promise<Email[]> {
    return await this.db.email.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByConversationIdOrdered(conversationId: string): Promise<Email[]> {
    return await this.db.email.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findFirstByConversationId(conversationId: string): Promise<Email | null> {
    return await this.db.email.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findManyWithCursor(
    conversationId: string,
    limit: number,
    cursor?: { id: string; createdAt: number }
  ): Promise<Email[]> {
    const where: any = { conversationId };

    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        {
          createdAt: new Date(cursor.createdAt),
          id: { lt: cursor.id },
        },
      ];
    }

    return await this.db.email.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async findManyWithForwardCursor(
    conversationId: string,
    limit: number,
    cursor?: { id: string; createdAt: number }
  ): Promise<Email[]> {
    const where: any = { conversationId };

    if (cursor) {
      where.OR = [
        { createdAt: { gt: new Date(cursor.createdAt) } },
        {
          createdAt: new Date(cursor.createdAt),
          id: { gt: cursor.id },
        },
      ];
    }

    return await this.db.email.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async findRootsByExternalThreadIds(
    externalThreadIds: string[]
  ): Promise<Array<{ id: string; externalThreadId: string }>> {
    if (externalThreadIds.length === 0) return [];

    return await this.db.email.findMany({
      // DEFAULT (inbound) and COMPOSE (outbound-new) are both thread roots.
      where: {
        externalThreadId: { in: externalThreadIds },
        type: { in: [EmailType.DEFAULT, EmailType.COMPOSE] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, externalThreadId: true },
    });
  }

  async findFirstByThreadAndChannel(
    externalThreadId: string,
    channelId: string,
  ): Promise<Email | null> {
    return await this.db.email.findFirst({
      where: { externalThreadId, channelId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByExternalMessageIds(
    channelId: string,
    externalMessageIds: string[],
  ): Promise<{ conversationId: string; externalThreadId: string } | null> {
    const expandedIds = [
      ...new Set(
        externalMessageIds.flatMap(id => {
          const trimmed = id.trim();
          if (!trimmed) return [];
          const withoutAngles = trimmed.replace(/^<|>$/g, '');
          return [trimmed, withoutAngles, `<${withoutAngles}>`];
        }),
      ),
    ];
    if (expandedIds.length === 0) return null;

    return this.db.email.findFirst({
      where: { channelId, externalMessageId: { in: expandedIds } },
      select: { conversationId: true, externalThreadId: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByRfcMessageIds(
    channelId: string,
    rfcMessageIds: string[],
  ): Promise<{ conversationId: string; externalThreadId: string } | null> {
    const normalizedRfcIds = normalizeRfcMessageIds(rfcMessageIds);
    const fallbackIds = [
      ...new Set(
        rfcMessageIds.flatMap(id => {
          const trimmed = id.trim();
          const normalized = normalizeRfcMessageId(trimmed);
          if (!trimmed && !normalized) return [];
          return [
            ...(trimmed ? [trimmed] : []),
            ...(normalized ? [normalized, `<${normalized}>`] : []),
          ];
        }),
      ),
    ];
    if (normalizedRfcIds.length === 0 && fallbackIds.length === 0) return null;

    return this.db.email.findFirst({
      where: {
        channelId,
        OR: [
          ...(normalizedRfcIds.length > 0 ? [{ rfcMessageId: { in: normalizedRfcIds } }] : []),
          ...(fallbackIds.length > 0 ? [{ externalMessageId: { in: fallbackIds } }] : []),
        ],
      },
      select: { conversationId: true, externalThreadId: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async backfillRfcMessageIdByExternalMessageId(
    channelId: string,
    externalMessageId: string,
    rfcMessageId?: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const normalized = normalizeRfcMessageId(rfcMessageId);
    if (!normalized) return { count: 0 };

    return (tx ?? this.db).email.updateMany({
      where: { channelId, externalMessageId, rfcMessageId: null },
      data: { rfcMessageId: normalized },
    });
  }

  async backfillRfcMessageIdsByExternalMessageId(
    channelId: string,
    rows: Array<{ externalMessageId: string; rfcMessageId?: string | null }>,
  ): Promise<number> {
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const normalized = normalizeRfcMessageId(row.rfcMessageId);
      if (!normalized) continue;
      const ids = grouped.get(normalized) ?? [];
      ids.push(row.externalMessageId);
      grouped.set(normalized, ids);
    }
    const results = await Promise.all(
      Array.from(grouped.entries()).map(([rfcId, extIds]) =>
        this.db.email.updateMany({
          where: { channelId, externalMessageId: { in: extIds }, rfcMessageId: null },
          data: { rfcMessageId: rfcId },
        }),
      ),
    );
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  async updateConversationId(emailId: string, conversationId: string): Promise<Email> {
    return await this.db.email.update({
      where: { id: emailId },
      data: { conversationId },
    });
  }

  async updateManyConversationIds(emailIds: string[], conversationId: string): Promise<{ count: number }> {
    return await this.db.email.updateMany({
      where: { id: { in: emailIds } },
      data: { conversationId },
    });
  }

  async update(
    id: string,
    data: Partial<{
      subject: string;
      body: string;
      to: string[];
      from: string;
      cc: string[];
      bcc: string[];
      replyTo: string[];
      externalThreadId: string;
      externalMessageId: string;
      sentByUserId: string | null;
    }>,
  ): Promise<Email> {
    return await this.db.email.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Email> {
    return await this.db.email.delete({
      where: { id },
    });
  }
}
