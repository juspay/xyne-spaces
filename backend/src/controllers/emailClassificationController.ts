/**
 * Email Classification Controller
 * Config + mappings are handled via Zero mutators.
 */

import { Request, Response } from 'express';
import { EmailClassificationRepository } from '../database/repositories/emailClassificationRepository.js';
import { EmailClassificationService } from '../services/emailClassificationService.js';
import { logger } from '../utils/logger.js';
import type { ClassificationPreviewBody } from '../types/classification.js';

export class EmailClassificationController {
  private repo = new EmailClassificationRepository();
  private service = new EmailClassificationService();

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
    const { ticketId } = req.params;
    const { fieldName, fieldValue } = req.body as { fieldName: string; fieldValue: string };
    if (!fieldName || fieldValue === undefined) {
      res.status(400).json({ error: 'fieldName and fieldValue are required' });
      return;
    }
    try {
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
}
