import { Router } from 'express';
import { transcriptionAgentController } from '@/controllers/transcriptionAgentController';

const router = Router();

// Transcript ready notification from Python agent
router.post('/:callId/transcript-ready', transcriptionAgentController.inCallWorkspace(transcriptionAgentController.transcriptReady));

// Call key + state for an agent job, before it joins the room
router.post('/:callId/session', transcriptionAgentController.inCallWorkspace(transcriptionAgentController.callSession));

// Get tickets assigned to user (AI assistant query tool)
router.get('/:callId/my-tickets', transcriptionAgentController.inCallWorkspace(transcriptionAgentController.getMyTickets));

// Search users by name (AI assistant invite tool)
router.get('/:callId/search-users', transcriptionAgentController.inCallWorkspace(transcriptionAgentController.searchUsers));

// Disabled: not call-scoped, so the shared agent key could read every tenant's data.
// router.get('/voiceprints', transcriptionAgentController.getVoiceprints);
// router.get('/user-names', transcriptionAgentController.getUserNames);

export default router;
