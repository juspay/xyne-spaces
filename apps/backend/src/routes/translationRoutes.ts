import { Router } from 'express';
import { TranslationController } from '../controllers/translationController';

const router = Router();
const translationController = new TranslationController();

router.post('/:messageId/translate', translationController.requestTranslation.bind(translationController));
router.post(
  '/:messageId/translation-feedback',
  translationController.submitFeedback.bind(translationController),
);

export default router;
