import { Router } from 'express';
import { DeskTagsConfigController } from '../controllers/deskTagsConfigController';

const router = Router({ mergeParams: true }); // mergeParams to access :channelId from parent
const controller = new DeskTagsConfigController();

router.get('/', controller.getConfig);
router.patch('/', controller.updateConfig);

export default router;
