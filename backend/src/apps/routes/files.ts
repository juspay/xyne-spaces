import { Router } from 'express';
import { FilesController } from '../controllers/filesController';
import { validateChannelAccess } from '../middelware/channelValidation';

const router = Router();
const filesController = new FilesController();

router.post('/filesUpload', validateChannelAccess, filesController.uploadFiles);

export default router;
