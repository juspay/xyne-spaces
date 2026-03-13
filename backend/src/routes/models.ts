import { Router } from 'express';
import { ModelController } from '../controllers/modelController';

const router = Router();
const modelController = new ModelController();

// Create a new model
router.post('/', modelController.createModel);

// Get all models with pagination and filtering
router.get('/', modelController.getAllModels);

// Get model by ID (supports includeAgents query parameter)
router.get('/:id', modelController.getModelById);

// Get model by userDefinedId
router.get('/user-defined/:userDefinedId', modelController.getModelByUserDefinedId);

// Update model by ID
router.put('/:id', modelController.updateModel);

// Get models by provider
router.get('/provider/:provider', modelController.getModelsByProvider);

// Get models by name
router.get('/name/:name', modelController.getModelsByName);

// Sync models with LiteLLM
router.post('/sync', modelController.syncModelsWithLiteLLM);

export default router;
