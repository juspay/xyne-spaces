import { Router } from 'express';
import { transcriptionAgentController } from '@/controllers/transcriptionAgentController';
import { transcriptionAgentRolloutController } from '@/controllers/transcriptionAgentRolloutController';

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

// Self-registration: a pod calls this once on startup with its own {agentName, role}
router.post('/register-agent', transcriptionAgentController.registerAgent);

// Manual ops fallback: list current agent assignments / flip a role to a new agentName.
// Same auth as the rest of this router (TRANSCRIPTION_AGENT_API_KEY) — these are hit by
// a human running curl, not a logged-in app user, so they don't belong behind the
// internal-service-to-service secret.
router.get('/agents', transcriptionAgentRolloutController.listAgents);
router.post('/rollout', transcriptionAgentRolloutController.rollout);

export default router;
