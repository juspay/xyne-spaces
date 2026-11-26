import { Router } from 'express';
import { FilesController } from '../controllers/filesController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


const router = Router();
const filesController = new FilesController();

router.post('/filesUpload', requirePermission('files:write'), validateChannelAccessForPost, filesController.uploadFiles);
router.get('/download/:attachmentId', requirePermission('files:read'), filesController.downloadFile);

export default router;
