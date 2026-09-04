import { Router } from 'express';
import { callController } from '@/controllers/callController';
import { recordingEmailController } from '@/controllers/recordingEmailController';
import { callHostControlController } from '@/controllers/callHostControlController';
import { scheduleCallController } from '@/controllers/scheduleCallController';
import { callChatController, requireInternalCallParticipant } from '@/controllers/callChatController';
import { uploadSingle } from '@/middleware/upload';
import { summaryTemplateController } from '@/controllers/summaryTemplateController';
import { recordingSharingController } from '@/controllers/recordingSharingController';
import { recordingGoogleDocController } from '@/controllers/recordingGoogleDocController';

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
router.post('/recordings/bulk-delete', callController.bulkDeleteRecordings);
router.post('/recordings/:callId/generate-summary', callController.regenerateRecordingSummary);
router.post('/recordings/:callId/generate-labels', callController.regenerateRecordingLabels);
router.get(
  '/recordings/:callId/email-compose-context',
  recordingEmailController.getComposeContext,
);
router.post('/recordings/:callId/send-email', recordingEmailController.sendRecordingEmail);
router.post('/recordings/:callId/export-google-doc', recordingGoogleDocController.export);
router.get('/recordings/:callId/google-doc-compose-context', recordingGoogleDocController.context);
router.post('/recordings/:callId/sharing', recordingSharingController.manage);
router.get('/recordings/:callId', callController.getRecordingDetail);
router.post('/recordings/:callId/participants', callController.manageRecordingParticipants);
router.patch('/recordings/:callId', callController.updateRecordingTitle);
router.delete('/recordings/:callId', callController.deleteRecording);
router.get('/summary-templates', summaryTemplateController.list);
router.post('/summary-templates', summaryTemplateController.create);
router.post('/summary-templates/ai/draft-context', summaryTemplateController.draftContext);
router.post('/summary-templates/ai/suggest-sections', summaryTemplateController.suggestSections);
router.post(
  '/summary-templates/ai/generate-system-prompt',
  summaryTemplateController.generateSystemPrompt
);
router.get('/summary-templates/publication/context', summaryTemplateController.publicationContext);
router.get('/summary-templates/:templateId/shares', summaryTemplateController.listShares);
router.post('/summary-templates/:templateId/sharing', summaryTemplateController.manageSharing);
router.post(
  '/summary-templates/:templateId/publication',
  summaryTemplateController.managePublication
);
router.patch('/summary-templates/:templateId', summaryTemplateController.update);
router.delete('/summary-templates/:templateId', summaryTemplateController.delete);
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

// Save in-call whiteboard PNG page - creates the MessageAttachment row at call end or page delete
router.post(
  '/:callId/save-whiteboard',
  uploadSingle({ fieldName: 'file', maxBytes: 15 * 1024 * 1024 }),
  callController.saveWhiteboardAttachment,
);

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

// Update a call's labels (the call's audience; recordings use /recordings/:callId)
router.patch('/:callId/labels', callController.updateCallLabels);

// Share a call with people, groups or channels. Same handler as the recordings
// route above — the service picks the entity type off the call's own type.
router.post('/:callId/sharing', recordingSharingController.manage);

// Draft a follow-up email and export to Google Docs. Same handlers as the
// /recordings routes above; both controllers branch on the call's own type.
router.get('/:callId/email-compose-context', recordingEmailController.getComposeContext);
router.post('/:callId/send-email', recordingEmailController.sendRecordingEmail);
router.get('/:callId/google-doc-compose-context', recordingGoogleDocController.context);
router.post('/:callId/export-google-doc', recordingGoogleDocController.export);

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

// Host controls: turn off/allow audio, camera, screen-share for all non-host participants (host only)
router.patch('/:callId/host-controls', callHostControlController.setHostControls);

// End-of-call transcript disposition when transcription was toggled off (host only): keep | discard
router.post('/:callId/transcript-disposition', callHostControlController.setTranscriptDisposition);

// Mid-call transcription on/off state → room metadata so late joiners sync (host only)
router.patch('/:callId/transcription-state', callHostControlController.setTranscriptionState);

// Remove a participant from the call (host only); rejoin requires re-admission
router.post('/:callId/remove-participant', callHostControlController.removeCallParticipant);

export default router;
