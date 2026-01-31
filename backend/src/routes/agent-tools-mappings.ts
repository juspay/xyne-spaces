import { Router } from 'express';
import { AgentToolsMappingController } from '../controllers/agentToolsMappingController';

const router = Router();
const mappingController = new AgentToolsMappingController();

// Create a new agent-tool mapping
router.post('/', mappingController.createMapping);

// Get all mappings with pagination and filtering
router.get('/', mappingController.getAllMappings);

// Get comprehensive mapping of all agents to all tools
router.get('/all-agents-tools-mapping', mappingController.getAllAgentsToolsMapping);

// Get enabled mappings
router.get('/enabled', mappingController.getEnabledMappings);

// Bulk create/update mappings
router.post('/bulk-create', mappingController.bulkCreateMappings);

// Get mappings by status
router.get('/status/:status', mappingController.getMappingsByStatus);

// Get mappings by agent ID
router.get('/agent/:agentId', mappingController.getMappingsByAgentId);

// Get mappings by tool ID
router.get('/tool/:toolId', mappingController.getMappingsByToolId);

// Get mapping by agent and tool
router.get('/agent/:agentId/tool/:toolId', mappingController.getMappingByAgentAndTool);

// Get mappings with details for an agent
router.get('/agent/:agentId/details', mappingController.getMappingsWithDetails);

// Enable tool for agent
router.post('/agent/:agentId/tool/:toolId/enable', mappingController.enableToolForAgent);

// Disable tool for agent
router.post('/agent/:agentId/tool/:toolId/disable', mappingController.disableToolForAgent);

// Map all tools to a specific agent
router.post('/agent/:agentId/map-all-tools', mappingController.mapAllToolsToAgent);

// Map a specific tool to all agents
router.post('/tool/:toolId/map-to-all-agents', mappingController.mapToolToAllAgents);

// Get mapping by ID
router.get('/:id', mappingController.getMappingById);

// Update mapping by ID
router.put('/:id', mappingController.updateMapping);

export default router;
