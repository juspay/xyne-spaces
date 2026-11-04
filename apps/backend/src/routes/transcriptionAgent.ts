import { Router } from 'express';
import { transcriptionAgentController } from '@/controllers/transcriptionAgentController';

const router = Router();

// Transcript ready notification from Python agent
router.post('/:callId/transcript-ready', transcriptionAgentController.transcriptReady);

// Ticket creation tool from Python agent (AI assistant)
router.post('/:callId/ticket', transcriptionAgentController.inCallWorkspace(transcriptionAgentController.ticketTool));

// Get tickets assigned to user (AI assistant query tool)
router.get('/:callId/my-tickets', transcriptionAgentController.inCallWorkspace(transcriptionAgentController.getMyTickets));

// Search users by name (AI assistant invite tool)
router.get('/:callId/search-users', transcriptionAgentController.inCallWorkspace(transcriptionAgentController.searchUsers));

// Disabled: not call-scoped, so the shared agent key could read every tenant's data.
// router.get('/voiceprints', transcriptionAgentController.getVoiceprints);
// router.get('/user-names', transcriptionAgentController.getUserNames);

export default router;
