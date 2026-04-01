/**
 * SAM Transcript Ingestion Controller
 * Handles transcript ingestion requests from SAM service (Pragati)
 * Validates input and returns 202 Accepted - actual Vespa insertion in Task 9
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { SamTranscriptInput } from '@/vespa/src/types';
import { insertSamTranscriptToVespa } from '@/zero/vespa-injection/tables/sam-transcripts-handler';

/**
 * Zod schema for validating SAM transcript payloads
 * Matches SamTranscriptInput interface from vespa types
 */
const ChapterSchema = z.object({
  timestamp: z.string(),
  topic: z.string(),
  content: z.string(),
});

const ActionItemSchema = z.object({
  timestamp: z.string(),
  assignee: z.string(),
  content: z.string(),
  deadLine: z.string().optional(),
});

const QnASchema = z.object({
  timestamp: z.string(),
  questioner: z.string(),
  answerer: z.string(),
  question: z.string(),
  answer: z.string(),
});

const OtherItemSchema = z.object({
  content: z.string(),
  speaker: z.string(),
  tags: z.array(z.string()),
});

const AIAnalysisSchema = z.object({
  summary: z.string(),
  chapters: z.array(ChapterSchema),
  action_items: z.array(ActionItemSchema),
  q_n_a: z.array(QnASchema),
  others: z.array(OtherItemSchema).optional(),
});

const SamTranscriptInputSchema = z.object({
  meetCode: z.string().min(1, 'meetCode is required'),
  participants: z.array(z.string()).min(1, 'participants must have at least one entry'),
  platform: z.string().min(1, 'platform is required'),
  type: z.string().min(1, 'type is required'),
  duration: z.string().min(1, 'duration is required'),
  aiAnalysedData: AIAnalysisSchema,
  dateTime: z.string().min(1, 'dateTime is required'),
  merchants: z.array(z.string()).default([]),
});

export class SamTranscriptController {
  /**
   * POST /api/sam/transcript
   * Called by SAM service (Pragati) to ingest meeting transcripts
   * Returns 202 Accepted - actual Vespa insertion happens
   * 
   * Body: SamTranscriptInput
   */
  ingestTranscript = async (req: Request, res: Response): Promise<void> => {
    try {
      const validationResult = SamTranscriptInputSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        logger.warn('[SamTranscriptController] Invalid transcript payload received', {
          errors: validationResult.error.flatten(),
          path: req.path,
        });
        res.status(400).json({
          error: 'Invalid input',
          details: validationResult.error.flatten(),
        });
        return;
      }

      const transcript: SamTranscriptInput = validationResult.data;
      const docId = uuidv4();

      logger.info('[SamTranscriptController] Received transcript for ingestion', {
        docId,
        meetCode: transcript.meetCode,
        participantCount: transcript.participants.length,
        platform: transcript.platform,
        type: transcript.type,
        duration: transcript.duration,
        hasAIAnalysis: !!transcript.aiAnalysedData,
      });

      this.processTranscriptAsync(transcript, docId);

      logger.info('[SamTranscriptController] Transcript validated and accepted for processing', {
        docId,
        meetCode: transcript.meetCode,
      });

      res.status(202).json({
        success: true,
        message: 'Transcript accepted for ingestion',
        docId,
      });
    } catch (error) {
      logger.error('[SamTranscriptController] Error processing transcript:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to process transcript',
      });
    }
  };

  private processTranscriptAsync = async (transcript: SamTranscriptInput, docId: string): Promise<void> => {
    try {
      const result = await insertSamTranscriptToVespa(docId, transcript);

      if (result.success) {
        logger.info('[SamTranscriptController] Successfully inserted transcript into Vespa', {
          docId,
          meetCode: transcript.meetCode,
        });
      } else {
        logger.error('[SamTranscriptController] Failed to insert transcript into Vespa', {
          docId,
          meetCode: transcript.meetCode,
          error: result.error,
        });
      }
    } catch (error) {
      logger.error('[SamTranscriptController] Error in async transcript processing', {
        docId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export const samTranscriptController = new SamTranscriptController();
