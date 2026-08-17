/**
 * Email Classification Controller
 * Config + mappings are handled via Zero mutators.
 */

import { Request, Response } from 'express';
import { EmailClassificationRepository } from '../database/repositories/emailClassificationRepository.js';
import { EmailClassificationService } from '../services/emailClassificationService.js';
import { assertChannelMembership, assertDeskOwner } from '@/utils/channelMembership';
import { logger } from '../utils/logger.js';
import type { ClassificationPreviewBody } from '../types/classification.js';

export class EmailClassificationController {
  private repo = new EmailClassificationRepository();
  private service = new EmailClassificationService();

  private async assertChannelAccess(
    req: Request,
    channelId: string,
    requireManageAccess = false,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) return access;
    if (!requireManageAccess) return { ok: true };

    const preference = await this.repo.findRawPreferenceByChannelId(channelId);
    const owned = assertDeskOwner(access, preference?.ownerUserId, 'Only the desk owner can manage classification settings');
    return owned.ok ? { ok: true } : owned;
  }

  /**
   * POST /channels/:channelId/classification/preview
   * Test classify a sample email — returns full AI output + resolved group.
   */
  previewClassification = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const { emailSubject, emailBody } = req.body as ClassificationPreviewBody;

    if (!emailSubject || !emailBody) {
      res.status(400).json({ error: 'emailSubject and emailBody are required' });
      return;
    }

    try {
      const access = await this.assertChannelAccess(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const classificationData = await this.service.classify(channelId, emailSubject, emailBody, {
        ignoreEnabled: true,
      });
      if (!classificationData) {
        res.status(400).json({ error: 'Classification config not found for this channel' });
        return;
      }
      const { result, config } = classificationData;
      const resolvedGroupId = await this.service.resolveUserGroup(result, config);
      res.status(200).json({ ...result, resolvedGroupId });
    } catch (error) {
      logger.error('[ClassificationController] previewClassification failed', { channelId, error });
      res.status(500).json({ error: 'Classification preview failed' });
    }
  };

  /**
   * PATCH /channels/:channelId/classification/tickets/:ticketId/raw-field
   * Update a single raw AI output field value on a ticket.
   */
  patchRawField = async (req: Request, res: Response): Promise<void> => {
    const { channelId, ticketId } = req.params;
    const { fieldName, fieldValue } = req.body as { fieldName: string; fieldValue: string };
    if (!fieldName || fieldValue === undefined) {
      res.status(400).json({ error: 'fieldName and fieldValue are required' });
      return;
    }
    try {
      const access = await this.assertChannelAccess(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      // The ticket must actually belong to the :channelId the caller was authorized against —
      // otherwise a participant of channel A could patch a ticket living in channel B.
      const ticket = await this.repo.findTicketById(ticketId);
      if (!ticket || ticket.channelId !== channelId) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }

      // Constrain fieldName to keys already present in the ticket's raw AI output — this
      // endpoint edits existing classification fields, so it must not inject arbitrary keys.
      const classificationData = (ticket.classificationData ?? {}) as Record<string, unknown>;
      const rawOutput = (classificationData.rawOutput ?? {}) as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(rawOutput, fieldName)) {
        res.status(400).json({ error: 'Unknown field' });
        return;
      }

      await this.repo.patchTicketRawOutput(ticketId, fieldName, fieldValue);
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[ClassificationController] patchRawField failed', { ticketId, error });
      res.status(500).json({ error: 'Failed to update field' });
    }
  };

  /**
   * PUT /channels/:channelId/classification/tickets/:ticketId/override-values
   * Manually override AI classification values, re-resolves user group.
   */
  overrideClassificationValues = async (req: Request, res: Response): Promise<void> => {
    const { channelId, ticketId } = req.params;
    const { category, subCategory } = req.body as { category: string; subCategory?: string | null };

    if (!category) {
      res.status(400).json({ error: 'category is required' });
      return;
    }

    try {
      const access = await this.assertChannelAccess(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      // The service resolves the user-group mapping from the supplied channel's config, so the
      // ticket must actually belong to that channel — otherwise routing/ownership can be tampered
      // by pairing an unrelated channelId with a ticket the caller cannot manage in its own channel.
      const ticket = await this.repo.findTicketById(ticketId);
      if (!ticket || ticket.channelId !== channelId) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }

      const resolvedGroupId = await this.service.overrideClassificationValues(
        ticketId,
        channelId,
        category,
        subCategory ?? null,
      );
      res.status(200).json({ success: true, resolvedGroupId });
    } catch (error) {
      logger.error('[ClassificationController] overrideClassificationValues failed', {
        channelId,
        ticketId,
        error,
      });
      res.status(500).json({ error: 'Failed to override classification values' });
    }
  };

  /**
   * GET /channels/:channelId/classification/ai-categories
   * Distinct AI categories present on this channel's tickets — powers the AI Category
   * filter options. ACL: channel member.
   */
  getAiCategories = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;

    try {
      const access = await this.assertChannelAccess(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const categories = await this.repo.findDistinctAiCategoriesByChannelId(channelId);
      res.status(200).json({ categories });
    } catch (error) {
      logger.error('[ClassificationController] getAiCategories failed', { channelId, error });
      res.status(500).json({ error: 'Failed to load AI categories' });
    }
  };
}
