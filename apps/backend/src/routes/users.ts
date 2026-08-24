import { Router } from 'express';
import { ChannelController } from '../controllers/channelController';
import { userManagementController } from '../controllers/userManagementController';
import { uploadConfig } from '../middleware/upload';
import { affinityController } from '../controllers/affinityController';
import { validateZod } from '../middleware/validation';
import { AddGroupDmParticipantsSchema } from '../validators/channelValidator';

const router = Router();
const channelController = new ChannelController();

// User search and listing routes (no ACL required, just auth)
// Note: Specific routes must come before parameterized routes
router.get('/search', userManagementController.searchUsers); // Search users
router.get('/guests', userManagementController.getGuestUsers); // List workspace guest access grants
router.delete('/guests/:userId/access/:entityType/:entityId', userManagementController.revokeGuestAccess); // Revoke one guest entity grant
router.get('/me/affinity', affinityController.getAffinity); // Get personalization weights
router.get('/me/dms', channelController.getUserDMs); // Get all user's DM channels
router.post('/me/questionnaire', userManagementController.saveQuestionnaireResponse); // Save current user's questionnaire response
router.post('/me/picture', uploadConfig.single('picture'), userManagementController.uploadProfilePicture); // Upload profile picture
router.patch('/me/calendar-visibility', userManagementController.updateCalendarVisibility); // Update calendar visibility
router.get('/:id/picture', userManagementController.streamProfilePicture); // Stream user's profile picture

// Voice signature routes (for meeting/recording speaker identification)
router.post('/me/voice-signature', uploadConfig.single('audio'), userManagementController.uploadVoiceSignature); // Upload audio → extract & store embedding
router.delete('/me/voice-signature', userManagementController.deleteVoiceSignature);          // Remove signature

router.get('/', userManagementController.getAllUsers); // Get all users (must come before /:id)
router.get('/:id', userManagementController.getUserById); // Get user by ID

// DM Routes
router.post('/me/dms', channelController.createNewDM); // Create new DM (1-on-1 or group)
router.get('/me/dms/:channelId/history-preview', channelController.getDmHistoryPreview); // Preview history that would be shared
router.post('/me/dms/:channelId/add', validateZod(AddGroupDmParticipantsSchema), channelController.addGroupDmParticipants); // Add participants to DM/GROUP_DM

export default router;
