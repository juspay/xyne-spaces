import { Router } from 'express';
import { FormController } from '../controllers/formController';

const router = Router();
const controller = new FormController();

// Form routes
router.post('/', controller.createForm);

export default router;
