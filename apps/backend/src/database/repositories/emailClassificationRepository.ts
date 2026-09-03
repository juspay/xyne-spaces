/**
 * Email Classification Repository
 * Data access layer — config stored on EmailChannelPreference, mappings in ClassificationMapping.
 */

import { DatabaseClient } from '../client';
import { TicketPriority } from '@xyne/shared';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import type { 
  SaveClassificationConfigBody, 
  SaveMappingBody, 
  SavePriorityClassificationConfigBody,
} from '../../types/classification.js';

export class EmailClassificationRepository {
  private db = DatabaseClient.getInstance();

  // ─── Config (on EmailChannelPreference) ──────────────────────────────────

  async findConfigByChannelId(channelId: string) {
    const pref = await this.db.emailChannelPreference.findUnique({
      where: { channelId },
    });
    if (!pref) return null;

    const mappings = await this.db.classificationMapping.findMany({
      where: { channelId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      channelId: pref.channelId,
      ownerUserId: pref.ownerUserId,
      enabled: pref.classificationEnabled || pref.priorityClassificationEnabled || false,
      classificationEnabled: pref.classificationEnabled ?? false,
      classificationPrompt: pref.classificationPrompt ?? '',
      categoryField: pref.categoryField ?? 'Query Type',
      subCategoryField: pref.subCategoryField ?? null,
      priorityClassificationEnabled: pref.priorityClassificationEnabled ?? false,
      priorityClassificationPrompt: pref.priorityClassificationPrompt ?? null,
      priorityClassificationThreshold: pref.priorityClassificationThreshold ?? 0.5,
      mappings,
    };
  }

  async findRawPreferenceByChannelId(channelId: string) {
    return this.db.emailChannelPreference.findUnique({
      where: { channelId },
      select: {
        channelId: true,
        ownerUserId: true,
        classificationEnabled: true,
        classificationPrompt: true,
        categoryField: true,
        subCategoryField: true,
        priorityClassificationEnabled: true,
        priorityClassificationPrompt: true,
        priorityClassificationThreshold: true,
      },
    });
  }

  async upsertConfig(channelId: string, data: SaveClassificationConfigBody) {
    const workspaceId = await resolveWorkspaceIdFromModel(this.db, 'channel', { id: channelId });
    await this.db.emailChannelPreference.upsert({
      where: { channelId },
      create: {
        channelId,
        workspaceId,
        classificationEnabled: data.enabled,
        classificationPrompt: data.classificationPrompt,
        categoryField: data.categoryField.trim(),
        subCategoryField: data.subCategoryField?.trim() ?? null,
      },
      update: {
        classificationEnabled: data.enabled,
        classificationPrompt: data.classificationPrompt,
        categoryField: data.categoryField.trim(),
        subCategoryField: data.subCategoryField?.trim() ?? null,
      },
    });

    return this.findConfigByChannelId(channelId);
  }

  // ─── Mappings ─────────────────────────────────────────────────────────────

  async createMapping(channelId: string, data: SaveMappingBody) {
    const workspaceId = await resolveWorkspaceIdFromModel(this.db, 'channel', { id: channelId });
    return this.db.classificationMapping.create({
      data: {
        channelId,
        workspaceId,
        category: data.category,
        subCategory: data.subCategory ?? null,
        userGroupId: data.userGroupId,
      },
    });
  }

  async updateMapping(mappingId: string, data: Partial<SaveMappingBody>) {
    return this.db.classificationMapping.update({
      where: { id: mappingId },
      data: {
        ...(data.category !== undefined && { category: data.category }),
        ...(data.subCategory !== undefined && { subCategory: data.subCategory ?? null }),
        ...(data.userGroupId !== undefined && { userGroupId: data.userGroupId }),
      },
    });
  }

  async deleteMapping(mappingId: string) {
    return this.db.classificationMapping.delete({ where: { id: mappingId } });
  }

  async findMappingById(mappingId: string) {
    return this.db.classificationMapping.findUnique({ where: { id: mappingId } });
  }

  // ─── AI Categories ────────────────────────────────────────────────────────

  /**
   * Distinct aiCategory values actually present on this channel's tickets (capped).
   * The AI emits free-form categories, so mappings alone are not a complete list —
   * a category with no assignment rule still needs to be filterable.
   */
  async findDistinctAiCategoriesByChannelId(channelId: string, limit = 500): Promise<string[]> {
    const rows = await this.db.ticket.findMany({
      where: { channelId, aiCategory: { not: null } },
      select: { aiCategory: true },
      distinct: ['aiCategory'],
      orderBy: { aiCategory: 'asc' },
      take: limit,
    });

    return rows
      .map(r => r.aiCategory?.trim())
      .filter((c): c is string => Boolean(c));
  }

  // ─── Priority Classification Config ───────────────────────────────────────

  async upsertPriorityConfig(
    channelId: string,
    data: SavePriorityClassificationConfigBody
  ) {
    const existing = await this.db.emailChannelPreference.findUnique({
      where: { channelId },
      select: { channelId: true },
    });

    if (!existing) {
      throw new Error('Email channel preference does not exist for this channel');
    }

    await this.db.emailChannelPreference.update({
      where: { channelId },
      data: {
        priorityClassificationEnabled: data.enabled,
        priorityClassificationPrompt: data.priorityClassificationPrompt ?? null,
        priorityClassificationThreshold: data.priorityClassificationThreshold ?? 0.5,
      },
    });

    return this.findConfigByChannelId(channelId);
  }

  // ─── Ticket classification data ───────────────────────────────────────────

  async updateTicketClassificationData(
    ticketId: string,
    classificationData: object & { category?: string; subCategory?: string | null; priority?: TicketPriority }
  ) {
    return this.db.ticket.update({
      where: { id: ticketId },
      data: {
        classificationData,
        ...(classificationData.category !== undefined ? { aiCategory: classificationData.category } : {}),
        ...(classificationData.subCategory !== undefined ? { aiSubCategory: classificationData.subCategory ?? null } : {}),
        ...(classificationData.priority !== undefined ? { aiPriority: classificationData.priority } : {}),
      },
    });
  }

  async patchTicketRawOutput(ticketId: string, fieldName: string, fieldValue: string) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      select: { classificationData: true },
    });
    if (!ticket) return;
    const existing = (ticket.classificationData ?? {}) as Record<string, unknown>;
    const rawOutput = { ...((existing.rawOutput as Record<string, unknown>) ?? {}), [fieldName]: fieldValue };
    await this.db.ticket.update({
      where: { id: ticketId },
      data: { classificationData: { ...existing, rawOutput } as object },
    });
  }

  async findTicketById(ticketId: string) {
    return this.db.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, classificationData: true, channelId: true },
    });
  }
}
