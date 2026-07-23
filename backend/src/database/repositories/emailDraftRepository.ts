import { DatabaseClient } from '../client';
import { getContextOrNull } from '@/database/tenant/context';
import { EmailDraft } from '@prisma/client';

export class EmailDraftRepository {
  private db = DatabaseClient.getInstance();

  // Resolve the denormalized tenant key for a draft from its channel, falling
  // back to the ambient tenant context.
  private async resolveWorkspaceId(channelId: string): Promise<string> {
    const channel = await this.db.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true },
    });
    const workspaceId = channel?.workspaceId ?? getContextOrNull()?.workspaceId;
    if (!workspaceId) {
      throw new Error(
        `workspaceId required: channel ${channelId} not found and no tenant context`,
      );
    }
    return workspaceId;
  }

  async create(data: {
    conversationId: string;
    channelId: string;
    draftContent: string;
    userId: string;
  }): Promise<EmailDraft> {
    if (!data.conversationId) {
      throw new Error('conversationId is required');
    }
    if (!data.channelId) {
      throw new Error('channelId is required');
    }
    if (!data.draftContent) {
      throw new Error('draftContent is required');
    }
    if (!data.userId) {
      throw new Error('userId is required');
    }

    const workspaceId = await this.resolveWorkspaceId(data.channelId);

    return await this.db.emailDraft.create({
      data: {
        workspaceId,
        conversationId: data.conversationId,
        channelId: data.channelId,
        draftContent: data.draftContent,
        userId: data.userId,
      },
    });
  }

  // Upsert a draft scoped to a channel + conversation (no user). There's no
  // unique index on (channelId, conversationId), so this finds-then-writes.
  async upsertForChannelConversation(data: {
    channelId: string;
    conversationId: string;
    draftContent: string;
  }): Promise<EmailDraft> {
    if (!data.conversationId) {
      throw new Error('conversationId is required');
    }
    if (!data.channelId) {
      throw new Error('channelId is required');
    }
    if (!data.draftContent) {
      throw new Error('draftContent is required');
    }

    const existing = await this.db.emailDraft.findFirst({
      where: { channelId: data.channelId, conversationId: data.conversationId },
    });
    if (existing) {
      return await this.db.emailDraft.update({
        where: { id: existing.id },
        data: { draftContent: data.draftContent },
      });
    }
    const workspaceId = await this.resolveWorkspaceId(data.channelId);
    return await this.db.emailDraft.create({
      data: {
        workspaceId,
        channelId: data.channelId,
        conversationId: data.conversationId,
        draftContent: data.draftContent,
      },
    });
  }

  async findByConversationId(conversationId: string): Promise<EmailDraft | null> {
    return await this.db.emailDraft.findFirst({
      where: {
        conversationId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.db.emailDraft.deleteMany({
      where: {
        id,
      },
    });
  }

  async deleteByConversationId(conversationId: string): Promise<void> {
    await this.db.emailDraft.deleteMany({
      where: {
        conversationId,
      },
    });
  }
}
