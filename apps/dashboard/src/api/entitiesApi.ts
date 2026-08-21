import { apiInstance } from '../services/clients/apiClient';

export type EntityVerdict = 'APPROVED' | 'REJECTED';

/**
 * A review of one entity on one message.
 *
 * Per-message rather than per-entity: extraction assigns an entity to a whole
 * thread, so the same entity can be right on the message that names it and wrong on
 * a reply that only inherited it.
 */
export interface EntityFeedback {
  messageId: string;
  conversationId: string;
  entityId: string;
  verdict: EntityVerdict;
  remarks: string | null;
  createdBy: string;
  updatedAt: string;
}

/** A row in the extraction registry (`non_zero.entities`). */
export interface EntityListItem {
  id: string;
  type: string;
  canonicalName: string;
  mentionCount: number;
  /** Known spellings that resolve to this entity — a high count usually means a messy entity. */
  aliasCount: number;
  /**
   * The actual spellings (capped server-side). Needed to highlight a mention: a
   * message's `entitySurfaceForms` is the whole thread's set with no mapping back
   * to an entity id, so this is the only way to know which span is this entity's.
   */
  aliases: string[];
}

/**
 * Registry and feedback. The messages behind an entity come from the shared search
 * endpoint, called directly as `GET /api/vespaSearch?entityId=…&groupBy=threadId` —
 * there is deliberately no wrapper for it here.
 */
export const entitiesApi = {
  listEntities: async (params: {
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entities: EntityListItem[]; total: number }> => {
    const res = await apiInstance.get<{ entities: EntityListItem[]; total: number }>('/entities', {
      params,
    });
    return res.data;
  },

  listTypes: async (): Promise<string[]> => {
    const res = await apiInstance.get<{ types: string[] }>('/entities/types');
    return res.data.types;
  },

  /**
   * Every review recorded for this entity, by every reviewer. `currentUserId` comes
   * back so the caller can tell its own verdict apart from other people's.
   */
  listFeedback: async (
    entityId: string,
  ): Promise<{ feedback: EntityFeedback[]; currentUserId: string }> => {
    const res = await apiInstance.get<{ feedback: EntityFeedback[]; currentUserId: string }>(
      `/entities/${entityId}/feedback`,
    );
    return res.data;
  },

  /**
   * Record a review of this entity on one message. Upserts, so re-reviewing
   * replaces the previous verdict. `remarks` is required when rejecting.
   */
  setFeedback: async (
    entityId: string,
    messageId: string,
    verdict: EntityVerdict,
    remarks?: string,
  ): Promise<EntityFeedback> => {
    const res = await apiInstance.put<EntityFeedback>(
      `/entities/${entityId}/feedback/${messageId}`,
      { verdict, ...(remarks ? { remarks } : {}) },
    );
    return res.data;
  },
};
