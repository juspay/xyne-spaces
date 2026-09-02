import { Router } from 'express';
import { InternalController } from '@/controllers/internalController';
import { transcriptionAgentRolloutController } from '@/controllers/transcriptionAgentRolloutController';
import { internalServiceAuth } from '@/middleware/internalServiceAuth';

const router = Router();
const internalController = new InternalController();

router.get('/org-members/check', internalServiceAuth, internalController.checkOrgMember);
router.post('/auth/email/login', internalServiceAuth, internalController.loginOrgMember);

router.get('/transcription-agent/agents', internalServiceAuth, transcriptionAgentRolloutController.listAgents);
router.post('/transcription-agent/rollout', internalServiceAuth, transcriptionAgentRolloutController.rollout);

export default router;
