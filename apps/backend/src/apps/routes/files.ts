import { Router } from 'express';
import { FilesController } from '../controllers/filesController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const filesController = new FilesController();

router.post('/filesUpload', requirePermission('files:write'), validateChannelAccessForPost, filesController.uploadFiles);
router.get('/info/:attachmentId', requirePermission('files:read'), filesController.getFileInfo);
router.get('/download/:attachmentId', requirePermission('files:read'), filesController.downloadFile);
router.get('/signed-url/:attachmentId', requirePermission('files:read'), filesController.getSignedDownloadUrl);

export default router;
