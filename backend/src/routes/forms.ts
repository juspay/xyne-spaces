import { Router } from 'express';
import { FormController } from '../controllers/formController';

const router = Router();
const controller = new FormController();

// Form routes
router.post('/', controller.createForm);
router.get('/global-fields', controller.getGlobalFields);
router.get('/:id', controller.getFormById);
router.put('/:id', controller.updateForm);

export default router;
