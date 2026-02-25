import { Router } from 'express';
import { callController } from '@/controllers/callController';

const router = Router();

// Call management endpoints
router.post('/initiate', callController.initiateCall);
router.post('/join', callController.joinCall);

// Recordings endpoints (HEADLESS calls)
router.get('/recordings', callController.getRecordings);
router.get('/recordings/:callId', callController.getRecordingDetail);
router.patch('/recordings/:callId', callController.updateRecordingTitle);
router.delete('/recordings/:callId', callController.deleteRecording);

// Manual endpoint to process transcript (triggered by user clicking "View Transcript" button)
router.post('/:callId/process-transcript', callController.processTranscript);

// Download transcript endpoint (downloads transcript file from GCS)
router.get('/:callId/download-transcript', callController.downloadTranscript);

// PRD Generation endpoint (generates PRD canvas from call transcript)
router.post('/:callId/generate-prd', callController.generatePRD);

// Detailed Summary Generation endpoint (generates comprehensive summary from call transcript)
router.post('/:callId/generate-detailed-summary', callController.generateDetailedSummary);

// Invite users to call (creates call_participants for notifications)
router.post('/:callId/invite', callController.inviteUsers);

// Decline call endpoint
router.post('/:callId/decline', callController.declineCall);

// Leave call endpoint
router.post('/:callId/leave', callController.leaveCall);

// End call for everyone (host only)
router.post('/:callId/end-for-all', callController.endCallForAll);

// Pulse actionable proxy (keeps Pulse credentials server-side)
router.post('/:callId/pulse-actionable', callController.createPulseActionable);

export default router;


