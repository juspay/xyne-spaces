import { Router } from 'express';
import { FilesController } from '../controllers/filesController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { fileInfo } from '@/handlers/settings';
import { appPermission } from '../access';

// Typed route (API.apps.files.info), served by the API router behind the contract gate.
api.routes(API.apps.files, (serve) => ({
  info: serve('info', { auth: 'app', access: { permission: appPermission('files:read') }, handle: ({ params, user }) => fileInfo({ params, user }) }),
}));

const router = Router();
const filesController = new FilesController();

router.post('/filesUpload', requirePermission('files:write'), validateChannelAccessForPost, filesController.uploadFiles);
router.get('/download/:attachmentId', requirePermission('files:read'), filesController.downloadFile);

export default router;
