import { DatabaseClient } from '../client';

export interface UpsertComposeDraftInput {
  draftId: string;
  /** Placeholder channel id of the form `composedm-<uuid>` (no real channel yet). */
  channelId: string;
  userId: string;
  content: string;
  recipientIds: string[];
  workspaceId: string | null;
}

export class DraftMessageRepository {
  private db = DatabaseClient.getInstance();

  /**
   * Owner-scoped upsert of a compose-DM draft (placeholder `composedm-` channel).
   *
   * The draftId is a per-mount UUID, so a PK
   * collision (P2002) can only come from a concurrent same-user
   * request (e.g. debounced autosave racing with teardown flush). On P2002 we
   * retry the update so the newer payload wins.
   *
   * @returns whether a new row was created (vs. an existing one updated).
   */
  async upsertComposeDraft(input: UpsertComposeDraftInput): Promise<{ created: boolean }> {
    // Store recipient ids as a comma-separated string (Prisma can't express nullable
    // Postgres arrays). Empty array → null so old rows and non-compose drafts stay NULL.
    const recipientIdsJoined =
      input.recipientIds.length > 0 ? input.recipientIds.join(',') : null;

    const updateData = {
      content: input.content,
      recipientIds: recipientIdsJoined,
    };

    // Update only the mutable fields; channelId/createdAt are immutable for a
    // given mount, and hasAttachment is owned by the attachment upload flow
    const updated = await this.db.draftMessage.updateMany({
      where: { id: input.draftId, userId: input.userId },
      data: updateData,
    });

    if (updated.count > 0) {
      return { created: false };
    }

    try {
      await this.db.draftMessage.create({
        data: {
          id: input.draftId,
          channelId: input.channelId,
          conversationId: null,
          messageId: null,
          userId: input.userId,
          content: input.content,
          recipientIds: recipientIdsJoined,
          hasAttachment: false,
          workspaceId: input.workspaceId,
        },
      });
      return { created: true };
    } catch (error) {
      // P2002 = a concurrent same-user request created the row between our
      // updateMany and create. Retry the update so our (potentially newer)
      // payload overwrites the stale data written by the winner.
      if ((error as { code?: string }).code === 'P2002') {
        await this.db.draftMessage.updateMany({
          where: { id: input.draftId, userId: input.userId },
          data: updateData,
        });
        return { created: false };
      }
      throw error;
    }
  }

  /**
   * Delete a compose-DM draft row after it has been sent.
   */
  async deleteComposeDraft(draftId: string, userId: string): Promise<void> {
    await this.db.draftMessage.deleteMany({
      where: { id: draftId, userId },
    });
  }
}
