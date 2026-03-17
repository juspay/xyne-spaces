import { Router } from 'express';
import { FilesController } from '../controllers/filesController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';

const router = Router();
const filesController = new FilesController();

router.post('/filesUpload', validateChannelAccessForPost, filesController.uploadFiles);

export default router;
