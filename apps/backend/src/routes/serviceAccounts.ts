import { Router } from 'express';
import { serviceAccountController } from '../controllers/serviceAccountController';

const router = Router();

router.get('/', serviceAccountController.list); // Service accounts the caller may manage
router.post('/', serviceAccountController.create); // Create, with the channels it may use
router.get('/:id', serviceAccountController.get); // One service account, with its keys
router.patch('/:id', serviceAccountController.update); // Rename or disable
router.post('/:id/channels', serviceAccountController.connectChannels); // Connect channels (channel admin)
router.delete('/:id/channels/:channelId', serviceAccountController.disconnectChannel); // Disconnect a channel
router.post('/:id/keys', serviceAccountController.createKey); // Create an S2S key (returned once)
router.post('/:id/keys/:keyId/revoke', serviceAccountController.revokeKey); // Revoke a key

export default router;
