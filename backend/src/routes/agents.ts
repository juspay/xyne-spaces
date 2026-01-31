import { Router } from 'express';
import { AgentController } from '../controllers/agentController';

const router = Router();
const agentController = new AgentController();

// Create a new agent
router.post('/', agentController.createAgent);

// Get unique agent names with latest versions (paginated)
router.get('/unique-names', agentController.getUniqueAgentNames);

// Get all agents with pagination and filtering
router.get('/', agentController.getAllAgents);

// Get agent by ID (supports include query parameter for relations)
router.get('/:id', agentController.getAgentById);

// Get agent by userDefinedId
router.get('/user-defined/:userDefinedId', agentController.getAgentByUserDefinedId);

// Get latest agent by name (supports include query parameter for relations)
router.get('/name/:name/latest', agentController.getLatestAgentByName);

router.post('/ai', agentController.invokeAI);

// Update agent by ID
router.put('/:id', agentController.updateAgent);

// Get agents by scope
router.get('/scope/:scope', agentController.getAgentsByScope);

// Get agents by model ID
router.get('/model/:modelId', agentController.getAgentsByModelId);

export default router;
