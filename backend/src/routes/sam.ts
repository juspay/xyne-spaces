/**
 * SAM Transcript Ingestion Routes
 * Handles transcript ingestion from SAM service (Pragati)
 */

import { Router } from 'express';
import { samTranscriptController } from '@/controllers/samTranscriptController';
import { verifySamCallback } from '@/middleware/samCallbackAuth';

const router = Router();

// POST /api/sam/transcript
// Called by SAM service to ingest meeting transcripts
router.post('/transcript', verifySamCallback, samTranscriptController.ingestTranscript);

export default router;
