/**
 * Priority Classification Controller
 * Handles priority classification preview and configuration.
 */

import { Request, Response } from 'express';
import { EmailClassificationService } from '../services/emailClassificationService.js';
import { EmailClassificationRepository } from '../database/repositories/emailClassificationRepository.js';
import { assertChannelMembership, assertDeskOwner } from '@/utils/channelMembership';
import { AgentsConfig } from '../agents/config.js';
import { logger } from '../utils/logger.js';
import type { PriorityClassificationPreviewBody, SavePriorityClassificationConfigBody } from '../types/classification.js';

export class PriorityClassificationController {
  private service = new EmailClassificationService();
  private repo = new EmailClassificationRepository();

  private async assertChannelAccess(
    req: Request,
    channelId: string,
    requireManageAccess = false,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) return access;
    if (!requireManageAccess) return { ok: true };

    const preference = await this.repo.findRawPreferenceByChannelId(channelId);
    const owned = assertDeskOwner(access, preference?.ownerUserId, 'Only the desk owner can manage priority settings');
    return owned.ok ? { ok: true } : owned;
  }

  /**
   * POST /channels/:channelId/priority-classification/preview
   * Test priority classification on a sample email.
   */
  previewClassification = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const { emailSubject, emailBody } = req.body as PriorityClassificationPreviewBody;

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

      const config = await this.repo.findConfigByChannelId(channelId);
      
      // Check if AgentsConfig is properly configured
      let modelName: string;
      try {
        const cacConfig = await AgentsConfig.fetch();
        modelName = cacConfig.classificationModelName;
        
        if (!modelName) {
          logger.warn('[PriorityClassificationController] classificationModelName not configured in CAC, using fallback');
          modelName = 'glm-flash-experimental'; // Fallback model
        }
      } catch (configError) {
        logger.error('[PriorityClassificationController] Failed to fetch AgentsConfig, using fallback model');
        modelName = 'glm-flash-experimental';
      }

      const priorityResult = await this.service.classifyPriority(
        channelId,
        emailSubject,
        emailBody,
        config?.priorityClassificationPrompt,
        modelName
      );

      if (!priorityResult) {
        logger.warn('[PriorityClassificationController] classifyPriority returned null');
        res.status(500).json({ error: 'Priority classification failed - unable to parse LLM response' });
        return;
      }

      res.status(200).json({
        priority: priorityResult.priority,
        confidence: priorityResult.confidence,
        reasoning: priorityResult.reasoning,
      });
    } catch (error) {
      logger.error('[PriorityClassificationController] previewClassification failed', {
        channelId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Priority classification preview failed' });
    }
  };

  /**
   * PUT /channels/:channelId/priority-classification/config
   * Update priority classification configuration.
   */
  updateConfig = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const { enabled, priorityClassificationPrompt, priorityClassificationThreshold } =
      req.body as SavePriorityClassificationConfigBody;

    try {
      const access = await this.assertChannelAccess(req, channelId, true);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      await this.repo.upsertPriorityConfig(channelId, {
        enabled,
        priorityClassificationPrompt,
        priorityClassificationThreshold,
      });

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[PriorityClassificationController] updateConfig failed', {
        channelId,
        error,
      });
      res.status(500).json({ error: 'Failed to update priority classification configuration' });
    }
  };
}
