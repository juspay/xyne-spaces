import express, { Router } from 'express';
import { recordingTemplateController } from '@/controllers/recordingTemplateController';

const router = Router();

/**
 * Routes for the page LiveKit egress opens to record an end-to-end encrypted call
 * (dashboard recording-template.html). Egress is not a signed-in user: the caller proves
 * itself with the LiveKit recorder token egress hands the page, verified in the controller.
 */
router.post('/call-key', express.json({ limit: '16kb' }), recordingTemplateController.callKey);

export default router;
