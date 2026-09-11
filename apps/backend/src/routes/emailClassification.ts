import { Router } from 'express';
import { EmailClassificationController } from '../controllers/emailClassificationController.js';

const router = Router({ mergeParams: true }); // mergeParams to access :channelId from parent
const controller = new EmailClassificationController();

// Preview
router.post('/preview', controller.previewClassification);

router.get('/ai-categories', controller.getAiCategories);

router.patch('/tickets/:ticketId/raw-field', controller.patchRawField);
router.put('/tickets/:ticketId/override-values', controller.overrideClassificationValues);

export default router;
