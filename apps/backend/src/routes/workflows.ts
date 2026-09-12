import { Router } from 'express';
import { WorkflowController } from '../controllers/workflowController';
import { ASTWorkflowParser } from '../workflows/services/astWorkflowParser';
import { workflowRegistry } from '../workflows/registry/workflowRegistry';
import {logger} from '@/utils/logger';

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
// import { WorkflowType } from '@/workflows';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dynamically discovers workflow files using AST parsing and maps them to workflow types
 */
function getWorkflowFileMap(): Record<string, string> {
  const definitionsDir = path.join(__dirname, '../workflows/definitions');

  try {
    return ASTWorkflowParser.createWorkflowFileMapping(definitionsDir);
  } catch (error) {
    logger.error('Error discovering workflow files with AST parsing:', error);
    return {};
  }
}

const router = Router();
const workflowController = new WorkflowController();
const astParser = new ASTWorkflowParser();

// ========== WORKFLOW TYPES API ENDPOINT ==========
// GET /api/workflows/types - Get all available workflow types with metadata
router.get('/types', async (_req, res): Promise<void> => {
  try {
    const workflowTypesResponse = await workflowRegistry.getWorkflowTypesForAPI();
    res.status(200).json(workflowTypesResponse);
  } catch (error) {
    logger.error('Error fetching workflow types:', error);
    res.status(500).json({
      error: 'Failed to fetch workflow types',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ========== WORKFLOW GRAPH ROUTE (Dynamic Execution) ==========
// GET /api/workflows/graph/:workflowType - Get workflow graph from dynamic execution
router.get('/graph/:workflowType', async (req, res): Promise<void> => {
  try {
    let { workflowType } = req.params;

    if (typeof workflowType === 'string') workflowType = workflowType.toUpperCase();
    else throw new Error('Invalid workflow type');

    // Dynamically discover workflow files - automatically includes all workflow files
    const workflowFileMap = getWorkflowFileMap();

    // Check if discovery failed completely
    if (Object.keys(workflowFileMap).length === 0) {
      res.status(500).json({
        error: 'Failed to discover workflow files',
        message: 'No workflow definitions could be found or parsed',
      });
      return;
    }

    const filePath = workflowFileMap[workflowType];

    if (!filePath) {
      res.status(404).json({
        error: 'Workflow type not found',
        availableTypes: Object.keys(workflowFileMap),
        requestedType: workflowType,
      });
      return;
    }

    // Verify the file actually exists
    if (!fs.existsSync(filePath)) {
      res.status(500).json({
        error: 'Workflow file not found',
        message: `Workflow file does not exist at path: ${filePath}`,
        workflowType,
      });
      return;
    }

    // Clear cache if requested via query parameter (for development)
    if (req.query.clearCache === 'true') {
      astParser.clearCache();
    }

    // Parse workflow with enhanced AST analysis to generate graph
    const graph = await astParser.parseWorkflowFileAdvanced(filePath, workflowType);
    res.json(graph);
  } catch (error) {
    logger.error('Error in AST workflow parsing:', error);
    res.status(500).json({
      error: 'Failed to parse workflow with AST analysis',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ========== WORKFLOW RESTORE ROUTES ==========
// POST /api/workflows/executions/:executionId/restore - Create rerun from restore point
router.post('/executions/:executionId/restore', workflowController.restoreWorkflowExecution);

// POST /api/workflows/executions/:executionId/rerun-from-start - Create rerun from start (no restore point)
router.post('/executions/:executionId/rerun-from-start', workflowController.rerunWorkflowFromStart);

// POST /api/workflows/executions/:executionId/continue - Continue agentic step with user input
router.post('/executions/:executionId/continue', workflowController.continueAgenticStep);

// GET /api/workflows/executions/:executionId/restore/preview - Preview effective restore point
router.get('/executions/:executionId/restore/preview', workflowController.getEffectiveRestorePoint);

// ========== WORKFLOW EXECUTION CONTROL ROUTES ==========
// PUT /api/workflows/executions/:executionId/pause - Pause workflow execution
router.put('/executions/:executionId/pause', workflowController.pauseWorkflowExecution);

// PUT /api/workflows/executions/:executionId/resume - Resume workflow execution
router.put('/executions/:executionId/resume', workflowController.resumeWorkflowExecution);

// PUT /api/workflows/executions/:executionId/cancel - Cancel workflow execution
router.put('/executions/:executionId/cancel', workflowController.cancelWorkflowExecution);

// GET /api/workflows/executions/:executionId/is-locked - Check if workflow execution is locked
router.get('/executions/:executionId/is-locked', workflowController.isWorkflowExecutionLocked);

// ========== EXECUTION MODE ROUTES ==========
// PUT /api/workflows/executions/:executionId/mode - Set execution mode (manual/automatic)
router.put('/executions/:executionId/mode', workflowController.setExecutionMode);

// GET /api/workflows/executions/:executionId/mode - Get execution mode
router.get('/executions/:executionId/mode', workflowController.getExecutionMode);

// ========== EXISTING ROUTES ==========
// Get workflow steps by execution ID (most specific first)
router.get('/executions/:executionId/steps', workflowController.getWorkflowStepsByExecutionId);

// ========== WORKFLOW STEP CRUD ROUTES ==========
// Get preceding steps (all steps that happened before a specific input step)
// NOTE: This must come BEFORE /steps/:id to avoid route conflicts
router.get('/steps/:stepId/preceding-steps', workflowController.getPrecedingSteps);

// GET /api/workflows/steps - Get all workflow steps
router.get('/steps', workflowController.getWorkflowSteps);

// GET /api/workflows/steps/:id - Get workflow step by ID
router.get('/steps/:id', workflowController.getWorkflowSteps);

// POST /api/workflows/steps - Create new workflow step
router.post('/steps', workflowController.createWorkflowStep);

// PUT /api/workflows/steps/:id - Update workflow step
router.put('/steps/:id', workflowController.updateWorkflowStep);

// ========== WORKFLOW EXECUTION CRUD ROUTES ==========
// GET /api/workflows/executions - Get all workflow executions
router.get('/executions', workflowController.getWorkflowExecutions);

// GET /api/workflows/executions/:id - Get workflow execution by ID
router.get('/executions/:id', workflowController.getWorkflowExecutions);

// POST /api/workflows/executions - Create new workflow execution
router.post('/executions', workflowController.createWorkflowExecution);

// PUT /api/workflows/executions/:id - Update workflow execution
router.put('/executions/:id', workflowController.updateWorkflowExecution);

// GET /api/workflows - Get all workflows
router.get('/', workflowController.getWorkflows);

// POST /api/workflows - Create new workflow
router.post('/', workflowController.createWorkflow);

// PUT /api/workflows/:id - Update workflow
router.put('/:id', workflowController.updateWorkflow);

// Get lightweight combined workflow steps for a ticket (performance optimized)
router.get('/:ticketId/combined-steps-light', workflowController.getCombinedStepsLight);

// Get step details for lazy loading (now returns both input and output)
router.get('/workflow-steps/:stepId/details', workflowController.getWorkflowStepDetails);

router.get('/:executionId/git-diff', workflowController.getWorkflowGitDiff);

// GET /api/workflows/:id - Get workflow by ID
// NOTE: This generic route must come AFTER all specific routes
router.get('/:id', workflowController.getWorkflows);

export default router;
