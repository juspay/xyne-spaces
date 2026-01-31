import { Router } from 'express';
import { ExternalStepResponseController } from '../controllers/externalStepResponseController';

const router = Router();
const externalStepResponseController = new ExternalStepResponseController();

// POST /api/external-step-responses
router.post('/', externalStepResponseController.createOrUpdateExternalStepResponse);

export default router;