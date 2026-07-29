import { Router } from 'express';
import { transcriptionAgentController } from '@/controllers/transcriptionAgentController';

const router = Router();

// Transcript ready notification from Python agent
router.post('/:callId/transcript-ready', transcriptionAgentController.transcriptReady);

// Ticket creation tool from Python agent (AI assistant)
router.post('/:callId/ticket', transcriptionAgentController.ticketTool);

// Get tickets assigned to user (AI assistant query tool)
router.get('/:callId/my-tickets', transcriptionAgentController.getMyTickets);

// Search users by name (AI assistant invite tool)
router.get('/:callId/search-users', transcriptionAgentController.searchUsers);

// Fetch all enrolled voice signatures for real-time speaker identification
router.get('/voiceprints', transcriptionAgentController.getVoiceprints);

// Fetch all workspace user display names for STT keyword hints
router.get('/user-names', transcriptionAgentController.getUserNames);

export default router;
