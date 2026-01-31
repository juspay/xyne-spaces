import { Router } from 'express';
import { ToolController } from '../controllers/toolController';

const router = Router();
const toolController = new ToolController();

// Create a new tool
router.post('/', toolController.createTool);

// Get all tools with pagination and filtering
router.get('/', toolController.getAllTools);

// Get tool by ID (supports includeAgents query parameter)
router.get('/:id', toolController.getToolById);

// Get tool by name
router.get('/name/:name', toolController.getToolByName);

// Update tool by ID
router.put('/:id', toolController.updateTool);

// Get tools by status
router.get('/status/:status', toolController.getToolsByStatus);

// Get enabled tools
router.get('/enabled', toolController.getEnabledTools);

export default router;
