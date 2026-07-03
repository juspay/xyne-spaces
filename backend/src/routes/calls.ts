import { Router } from 'express';
import { callController } from '@/controllers/callController';
import { callHostControlController } from '@/controllers/callHostControlController';
import { scheduleCallController } from '@/controllers/scheduleCallController';
import { callChatController, requireInternalCallParticipant } from '@/controllers/callChatController';

const router = Router();

// Call management endpoints
router.post('/series', scheduleCallController.createRecurringSeries);
router.patch('/series/:seriesId', scheduleCallController.updateRecurringSeries);
router.delete('/series/:seriesId', scheduleCallController.cancelRecurringSeries);
router.post('/initiate', callController.initiateCall);
router.post('/join', callController.joinCall);
router.post('/schedule', scheduleCallController.scheduleCall);

// Recordings endpoints (HEADLESS calls)
router.get('/recordings', callController.getRecordings);
router.get('/recordings/:callId', callController.getRecordingDetail);
router.patch('/recordings/:callId', callController.updateRecordingTitle);
router.delete('/recordings/:callId', callController.deleteRecording);
// Pulse org list proxy (must be before /:callId wildcard)
router.get('/pulse-orgs', callController.getPulseOrgs);

router.post('/summary-prompt/edit', callController.editSummaryPrompt);

router.post('/chat/:externalId/messages', requireInternalCallParticipant, callChatController.sendMessage);
router.get('/chat/:externalId/messages', requireInternalCallParticipant, callChatController.getMessages);
router.get('/chat/:externalId/participants', requireInternalCallParticipant, callChatController.getParticipants);

// Get another user's scheduled calls (must come before /:callId wildcard)
router.get('/user/:userId/scheduled', scheduleCallController.getOtherUserScheduledCalls);

// Edit a single scheduled call instance (must come after all static /... routes)
router.patch('/:callId', scheduleCallController.updateScheduledCall);
router.delete('/:callId', scheduleCallController.cancelScheduledCall);

// Manual endpoint to process transcript (triggered by user clicking "View Transcript" button)
router.post('/:callId/process-transcript', callController.processTranscript);

// Download transcript endpoint (downloads transcript file from GCS)
router.get('/:callId/download-transcript', callController.downloadTranscript);

// Download recording endpoint (streams the call's latest recording — legacy/headless player)
router.get('/:callId/download-recording', callController.downloadRecording);

// In-call recordings (call_recordings table) — per-recording download, rename, delete
router.get('/:callId/recordings/:recordingId/download', callController.downloadCallRecording);
router.patch('/:callId/recordings/:recordingId', callController.renameCallRecording);
router.delete('/:callId/recordings/:recordingId', callController.deleteCallRecording);

// PRD Generation endpoint (generates PRD canvas from call transcript)
router.post('/:callId/generate-prd', callController.generatePRD);

// Detailed Summary Generation endpoint (generates comprehensive summary from call transcript)
router.post('/:callId/generate-detailed-summary', callController.generateDetailedSummary);

// Invite users to call (creates call_participants for notifications)
router.post('/:callId/invite', callController.inviteUsers);

// Decline call endpoint
router.post('/:callId/decline', callController.declineCall);

// RSVP endpoint for scheduled calls
router.post('/:callId/rsvp', callController.updateMeetingStatus);

// Hide call endpoint (participant-only, irreversible)
router.post('/:callId/hide', callController.hideCall);

// Get call participants (for native Participants screen)
router.get('/:callId/participants', callController.getCallParticipants);

// Get call chat history (for recording detail page)
router.get('/:callId/chat-history', callController.getCallChatHistory);

// Leave call endpoint
router.post('/:callId/leave', callController.leaveCall);

// End call for everyone (host only)
router.post('/:callId/end-for-all', callController.endCallForAll);

// Pulse actionable proxy (keeps Pulse credentials server-side)
router.post('/:callId/pulse-actionable', callController.createPulseActionable);
// Mute all participants endpoint
router.post('/:callId/mute-all', callController.muteAllParticipants);

// Mute individual participant endpoint (host only)
router.post('/:callId/mute-participant', callController.muteParticipant);

// In-call recording start/stop (any participant; starter-only to stop)
router.post('/:callId/recording/start', callController.startCallRecording);
router.post('/:callId/recording/stop', callController.stopCallRecording);

// Host controls: lock/unlock mic, camera, screen-share for all non-host participants (host only)
router.patch('/:callId/host-controls', callHostControlController.setHostControls);

// Remove a participant from the call (host only); rejoin requires re-admission
router.post('/:callId/remove-participant', callHostControlController.removeCallParticipant);

export default router;
