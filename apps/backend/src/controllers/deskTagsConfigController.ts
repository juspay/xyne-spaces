import { Request, Response } from 'express';
import { tagService, TagsConfigShapeSchema, invalidateTagConfigCache, DEFAULT_DESK_EMAIL_CONFIG } from '@/tags';
import { deskEmailConfigKey, DESK_EMAIL_SOURCE_TYPE } from '@/tags';
import { getGroupedTagsWithConfig } from '@/tags/presentation';
import type { TagsConfigShape } from '@/tags';
import { logger } from '../utils/logger';
import { TAG_FORMAT_REGEX, ChannelRole, TagMethod } from '@xyne/shared';
import { db } from '@/database/client';
import { TagServiceError } from '@/tags/service';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { EmailClassificationRepository } from '@/database/repositories/emailClassificationRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { generateLlmTags } from '@/tags/generators/llm';
import { tagRepository } from '@/database/repositories/tagRepository';

/**
 * Epoch-ms query param as a Date, or null when it is missing or unusable. The
 * blank guard is trimmed: Number('') and Number('  ') are both 0, so `?startMs=`
 * or `?startMs=%20` would otherwise read as epoch 0 and scan all history.
 */
const epochMsToDate = (raw: unknown): Date | null => {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const ms = trimmed ? Number(trimmed) : NaN;
  const date = new Date(ms);
  return Number.isFinite(ms) && !Number.isNaN(date.getTime()) ? date : null;
};

/**
 * Server-side ceiling on the generated-tags window. The Topics Explorer caps at
 * 7 calendar days client-side, but that is not a control: without this a
 * hand-crafted multi-year request reads the channel's whole email table and
 * every tag row hanging off it. A 7-day inclusive range runs 00:00 on day one
 * to 23:59 on day seven, so it measures one millisecond under the cap.
 */
const MAX_TAG_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export class DeskTagsConfigController {
  private channelParticipantRepo = new ChannelParticipantRepository();
  private channelRepo = new ChannelRepository();
  private classificationRepo = new EmailClassificationRepository();
  private emailRepo = new EmailRepository();

  private async assertAccess(
    req: Request,
    res: Response,
    channelId: string,
    requireManageAccess = false,
  ): Promise<string | null> {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    const channel = await this.channelRepo.findById(channelId);
    if (!channel || channel.workspaceId !== workspaceId) {
      res.status(404).json({ error: 'Channel not found' });
      return null;
    }

    // Single query gives membership + role together
    const participant = await this.channelParticipantRepo.findParticipant(channelId, userId);
    if (!participant) {
      res.status(403).json({ error: 'Not a member of this channel' });
      return null;
    }

    if (requireManageAccess) {
      if (participant.role === ChannelRole.ADMIN) return userId;        // channel admin
      if (channel.createdBy === userId) return userId;                  // channel creator
      const preference = await this.classificationRepo.findRawPreferenceByChannelId(channelId);
      if (preference?.ownerUserId === userId) return userId;            // desk owner
      res.status(403).json({ error: 'Only the desk owner or a channel admin can manage tag generation config' });
      return null;
    }

    return userId;
  }

  /**
   * GET /api/channels/:channelId/tags-config
   * Returns the desk-email tag-generation categories configured for this channel.
   */
  getConfig = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = await this.assertAccess(req, res, channelId);
    if (!userId) return;

    try {
      const config = await tagService.getConfig(deskEmailConfigKey(channelId));
      if (!config) {
        res.status(200).json({ categories: DEFAULT_DESK_EMAIL_CONFIG.categories, isDefault: true });
        return;
      }
      const parsed = TagsConfigShapeSchema.safeParse(config.config);
      const categories = parsed.success ? parsed.data.categories : {};
      res.status(200).json({ categories, isDefault: false });
    } catch (error) {
      logger.error('[DESK-TAGS-CONFIG] Failed to get config', { channelId, error });
      res.status(500).json({ error: 'Failed to get tag generation config' });
    }
  };

  /**
   * PATCH /api/channels/:channelId/tags-config
   * Replaces the desk-email tag-generation categories for this channel.
   * Requires desk owner or channel admin.
   */
  updateConfig = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = await this.assertAccess(req, res, channelId, true);
    if (!userId) return;
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) return; // assertAccess already guaranteed this; satisfies TS

    const { categories } = req.body as { categories?: unknown };

    const parsed = TagsConfigShapeSchema.safeParse({ categories });
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid categories', issues: parsed.error.issues });
      return;
    }

    const configKey = deskEmailConfigKey(channelId);
    const shape: TagsConfigShape = parsed.data;

    try {
      await tagService.upsertConfig(configKey, DESK_EMAIL_SOURCE_TYPE, workspaceId, shape, userId);
      // Evict the worker-side Redis cache so the pipeline picks up the new config
      // on the very next job rather than waiting for the TTL to expire.
      await invalidateTagConfigCache(configKey);
      res.status(200).json({ categories: shape.categories });
    } catch (error) {
      logger.error('[DESK-TAGS-CONFIG] Failed to update config', { channelId, error });
      res.status(500).json({ error: 'Failed to update tag generation config' });
    }
  };

  /**
   * POST /api/channels/:channelId/tags-config/preview
   * Runs tag generation against the channel's current config on a synthetic email
   * (subject + body provided by the caller). Does not persist any tags.
   * ACL: channel member (read-only operation).
   */
  previewTagGeneration = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = await this.assertAccess(req, res, channelId);
    if (!userId) return;

    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { subject, body } = req.body as { subject?: unknown; body?: unknown };
    if (typeof subject !== 'string' || !subject.trim()) {
      res.status(400).json({ error: 'subject is required' });
      return;
    }
    if (typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ error: 'body is required' });
      return;
    }

    try {
      const configRow = await tagService.getConfig(deskEmailConfigKey(channelId));
      const parsed = configRow ? TagsConfigShapeSchema.safeParse(configRow.config) : null;
      const allCategories =
        parsed?.success ? parsed.data.categories : DEFAULT_DESK_EMAIL_CONFIG.categories;

      // Only LLM categories produce output — manual categories are skip-listed in the pipeline.
      const llmCategories = Object.fromEntries(
        Object.entries(allCategories).filter(([, cfg]) => cfg.method === 'llm'),
      );

      if (Object.keys(llmCategories).length === 0) {
        res.status(200).json({ tags: [] });
        return;
      }

      const context = `Subject: ${subject.trim()}\n\n${body.trim()}`;

      const tags = await generateLlmTags(context, llmCategories, workspaceId);
      res.status(200).json({ tags });
    } catch (error) {
      logger.error('[DESK-TAGS-CONFIG] previewTagGeneration failed', { channelId, error });
      res.status(500).json({ error: 'Tag generation preview failed' });
    }
  };

  /**
   * GET /api/channels/:channelId/tags-config/all-generated-tags
   * Returns all distinct category:tag pairs that exist for this channel (capped at 500).
   * ACL: channel member.
   */
  getAllGeneratedTags = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = await this.assertAccess(req, res, channelId);
    if (!userId) return;

    try {
      const rows = await tagRepository.findDistinctTagsByConfigKey(deskEmailConfigKey(channelId));
      res.status(200).json({ tags: rows.map(r => ({ category: r.tagCategory, tag: r.tag })) });
    } catch (error) {
      logger.error('[DESK-TAGS-CONFIG] getAllGeneratedTags failed', { channelId, error });
      res.status(500).json({ error: 'Failed to load generated tags' });
    }
  };

  /**
   * GET /api/channels/:channelId/tags-config/conversations-by-tags?tags[]=priority:high
   * Returns conversationIds of tickets where any email in the conversation carries
   * any of the requested category:tag values (OR semantics across all emails in the thread).
   * ACL: channel member.
   */
  filterConversationsByTags = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = await this.assertAccess(req, res, channelId);
    if (!userId) return;

    const rawTags = req.query['tags'];
    const generatedTags: string[] = Array.isArray(rawTags)
      ? (rawTags as string[]).filter(t => typeof t === 'string' && t.includes(':'))
      : typeof rawTags === 'string' && rawTags.includes(':')
        ? [rawTags]
        : [];

    if (generatedTags.length === 0) {
      res.status(400).json({ error: 'At least one tag in "category:value" format is required' });
      return;
    }

    logger.info('[DESK-TAGS-CONFIG] filterConversationsByTags entered', { channelId, generatedTags });

    try {
      const conversationIds = await tagRepository.findConversationIdsByEmailTags(
        channelId,
        generatedTags,
      );
      logger.info('[DESK-TAGS-CONFIG] filterConversationsByTags success', { channelId, count: conversationIds.length });
      res.status(200).json({ conversationIds });
    } catch (error) {
      logger.error('[DESK-TAGS-CONFIG] filterConversationsByTags failed', { channelId, generatedTags, error });
      res.status(500).json({ error: 'Failed to filter conversations by tags' });
    }
  };

  /**
   * GET /api/channels/:channelId/tags-config/generated-tags-by-conversation?startMs=…&endMs=…
   *
   * Tag values per conversation for this channel in the given date range. Tags
   * live in the `non_zero` schema, which Zero does not mirror, so this is the
   * only read path for grouping tickets by tag category.
   * ACL: channel member.
   */
  getGeneratedTagsByConversation = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = await this.assertAccess(req, res, channelId);
    if (!userId) return;

    const start = epochMsToDate(req.query['startMs']);
    const end = epochMsToDate(req.query['endMs']);
    if (!start || !end || start > end) {
      res.status(400).json({
        error: 'startMs and endMs must be epoch-millisecond values, with startMs before endMs',
      });
      return;
    }
    if (end.getTime() - start.getTime() > MAX_TAG_RANGE_MS) {
      res.status(400).json({
        error: `Date range cannot exceed ${MAX_TAG_RANGE_MS / (24 * 60 * 60 * 1000)} days`,
      });
      return;
    }

    try {
      const rows = await tagRepository.findGeneratedTagsByConversation(
        channelId,
        deskEmailConfigKey(channelId),
        start,
        end,
      );

      const byConversation = new Map<string, { category: string; tag: string }[]>();
      for (const row of rows) {
        const tags = byConversation.get(row.conversationId) ?? [];
        tags.push({ category: row.tagCategory, tag: row.tag });
        byConversation.set(row.conversationId, tags);
      }

      const conversations = [...byConversation].map(([conversationId, tags]) => ({
        conversationId,
        tags,
      }));

      res.status(200).json({ conversations });
    } catch (error) {
      logger.error('[DESK-TAGS-CONFIG] getGeneratedTagsByConversation failed', { channelId, error });
      res.status(500).json({ error: 'Failed to load generated tags by conversation' });
    }
  };

  // Resolves emailId → channelId. Responds 404 if email not found.
  private async getChannelIdFromEmail(emailId: string, res: Response): Promise<string | null> {
    const email = await this.emailRepo.findById(emailId);
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return null;
    }
    return email.channelId;
  }

  /**
   * GET /api/tags/entity/desk-email/:emailId
   * Returns grouped tags + config options for a specific email.
   * ACL: user must be a channel member.
   */
  getDeskEmailTags = async (req: Request, res: Response): Promise<void> => {
    const { emailId } = req.params;

    const channelId = await this.getChannelIdFromEmail(emailId, res);
    if (!channelId) return;

    const userId = await this.assertAccess(req, res, channelId);
    if (!userId) return;

    try {
      const groups = await getGroupedTagsWithConfig(emailId, DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey(channelId));
      res.json({ groups });
    } catch (error) {
      logger.error('[DESK-TAGS] Failed to get email tags', { emailId, error });
      res.status(500).json({ error: 'Failed to get email tags' });
    }
  };

  /**
   * POST /api/tags/entity/desk-email/:emailId
   * Manually adds a tag to a specific email.
   * ACL: user must be desk owner, channel creator, or channel admin.
   */
  addDeskEmailTag = async (req: Request, res: Response): Promise<void> => {
    const { emailId } = req.params;
    const { category, tag } = req.body ?? {};

    if (typeof category !== 'string' || typeof tag !== 'string') {
      res.status(400).json({ error: 'category and tag are required' });
      return;
    }
    if (!TAG_FORMAT_REGEX.test(category)) {
      res.status(400).json({ error: `Tag category "${category}" does not match required format (lowercase, hyphen-separated, alphanumeric)` });
      return;
    }
    if (!TAG_FORMAT_REGEX.test(tag)) {
      res.status(400).json({ error: `Tag "${tag}" does not match required format (lowercase, hyphen-separated, alphanumeric)` });
      return;
    }

    const channelId = await this.getChannelIdFromEmail(emailId, res);
    if (!channelId) return;

    const userId = await this.assertAccess(req, res, channelId, true);
    if (!userId) return;

    const workspaceId = req.user?.workspaceId!;
    const configKey = deskEmailConfigKey(channelId);

    try {
      const configRow = await tagService.getConfig(configKey);
      const configCategories = configRow
        ? ((configRow.config as any)?.categories ?? {})
        : DEFAULT_DESK_EMAIL_CONFIG.categories;
      const catConfig = configCategories[category];
      if (!catConfig) {
        res.status(400).json({ error: `Tag category "${category}" is not configured` });
        return;
      }

      const allowedTags: string[] = catConfig.tags ?? [];
      if (!catConfig.is_new_tag_allowed && !allowedTags.includes(tag)) {
        res.status(400).json({ error: `Tag "${tag}" is not in the allowed list for category "${category}"` });
        return;
      }

      // Advisory lock scoped to (sourceType, sourceId, category) serializes concurrent
      // manual tag adds for the same entity+category without requiring serializable isolation.
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tag-add:${DESK_EMAIL_SOURCE_TYPE}:${emailId}:${category}`}))`;

        const existing = await tx.tag.findFirst({
          where: { sourceId: emailId, sourceType: DESK_EMAIL_SOURCE_TYPE, tagCategory: category, tag, isDeleted: false },
        });
        if (existing) {
          throw new TagServiceError(
            `Active tag "${tag}" already exists for ${DESK_EMAIL_SOURCE_TYPE}/${emailId} in category "${category}"`,
            409,
          );
        }

        if (catConfig.count != null) {
          const current = await tx.tag.count({
            where: { sourceId: emailId, sourceType: DESK_EMAIL_SOURCE_TYPE, tagCategory: category, isDeleted: false },
          });
          if (current >= catConfig.count) {
            throw new TagServiceError(
              `Maximum tag count (${catConfig.count}) reached for category "${category}"`,
              400,
            );
          }
        }

        await tx.tag.create({
          data: {
            sourceId: emailId,
            sourceType: DESK_EMAIL_SOURCE_TYPE,
            workspaceId,
            configKey,
            tagCategory: category,
            tag,
            method: TagMethod.MANUAL,
            createdBy: userId,
            updatedBy: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isDeleted: false,
          },
        });
      });

      res.status(201).json({ success: true });
    } catch (error: any) {
      if (error?.status === 409) {
        logger.debug('[DESK-TAGS] addDeskEmailTag: tag already exists (idempotent)', { emailId, category, tag });
        res.status(200).json({ success: true, existed: true });
        return;
      }
      logger.error('[DESK-TAGS] Failed to add email tag', { emailId, category, tag, error });
      res.status(error?.status ?? 500).json({ error: error?.message ?? 'Failed to add tag' });
    }
  };

  /**
   * DELETE /api/tags/entity/desk-email/:emailId
   * Removes a manually-added tag from a specific email.
   * ACL: user must be desk owner, channel creator, or channel admin.
   */
  removeDeskEmailTag = async (req: Request, res: Response): Promise<void> => {
    const { emailId } = req.params;
    const { category, tag } = req.body ?? {};

    if (typeof category !== 'string' || typeof tag !== 'string') {
      res.status(400).json({ error: 'category and tag are required' });
      return;
    }

    const channelId = await this.getChannelIdFromEmail(emailId, res);
    if (!channelId) return;

    const userId = await this.assertAccess(req, res, channelId, true);
    if (!userId) return;

    const configKey = deskEmailConfigKey(channelId);

    try {
      await tagService.deleteTag(emailId, DESK_EMAIL_SOURCE_TYPE, category, tag, userId, true, configKey);
      res.json({ success: true });
    } catch (error: any) {
      if (error?.status === 404) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error('[DESK-TAGS] Failed to remove email tag', { emailId, category, tag, error });
      res.status(500).json({ error: 'Failed to remove tag' });
    }
  };
}
