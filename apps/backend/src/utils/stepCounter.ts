import {logger} from '@/utils/logger';

// Step counter utility for workflow progress calculation

// In-memory cache for workflow graphs (since they're static definitions)
const workflowGraphCache = new Map<string, WorkflowGraph>();

// Types for workflow progress
export interface WorkflowPhaseProgress {
  totalPhases: number;
  completedPhases: number;
  currentPhase: string | null;
  percentComplete: number;
}

export interface CurrentPhaseDetail {
  completedSteps: number;
  activeSteps: number;
  failedSteps: number;
}

export interface StepCompletion {
  workflowPhases: WorkflowPhaseProgress;
  currentPhaseDetail: CurrentPhaseDetail;
}

interface WorkflowGraphNode {
  id: string;
  name: string;
  type: 'checkpoint' | 'agent' | 'conditional' | 'external' | 'loop';
}

interface WorkflowGraph {
  workflowType: string;
  name: string;
  description: string;
  nodes: WorkflowGraphNode[];
}

interface WorkflowData {
  workflowType: string;
  steps: Array<{
    stepName: string;
    status: string;
    stepExecutorType: string;
    expandedExecutions?: Array<{
      steps: Array<{
        stepName: string;
        status: string;
      }>;
    }>;
    expandedWorkflows?: Array<{
      steps: Array<{
        stepName: string;
        status: string;
      }>;
    }>;
  }>;
}

// Get workflow graph using direct imports (avoiding HTTP auth issues) with caching
async function fetchWorkflowGraph(workflowType: string): Promise<WorkflowGraph | null> {
  const cacheKey = workflowType.toUpperCase();

  // Check cache first
  if (workflowGraphCache.has(cacheKey)) {
    return workflowGraphCache.get(cacheKey)!;
  }

  try {
    // Import the required modules directly
    const { ASTWorkflowParser } = await import('../workflows/services/astWorkflowParser');
    const path = await import('path');
    const fs = await import('fs');
    const { fileURLToPath } = await import('url');

    // Get workflow file mapping
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const definitionsDir = path.join(__dirname, '../workflows/definitions');

    const workflowFileMap = ASTWorkflowParser.createWorkflowFileMapping(definitionsDir);
    const filePath = workflowFileMap[cacheKey];

    if (!filePath || !fs.existsSync(filePath)) {
      logger.warn(`Workflow file not found for ${workflowType}`);
      return null;
    }

    // Parse workflow with enhanced AST analysis to generate graph
    const astParser = new ASTWorkflowParser();
    const graph = await astParser.parseWorkflowFileAdvanced(filePath, workflowType);
    const workflowGraph = graph as WorkflowGraph;

    // Cache the result for future use
    if (workflowGraph) {
      workflowGraphCache.set(cacheKey, workflowGraph);
    }

    return workflowGraph;
  } catch (error) {
    logger.error(`Error fetching workflow graph for ${workflowType}:`, error);
    return null;
  }
}

// Clear cache when needed (for development or when workflow definitions change)
export function clearWorkflowGraphCache(): void {
  workflowGraphCache.clear();
}

// Map execution step names to workflow phase names
function mapStepToPhase(stepName: string, workflowGraph: WorkflowGraph): string | null {
  if (!stepName) {
    return null;
  }

  // Remove iteration suffixes (e.g., "implementation_verification_loop.iter_1.implementation" -> "implementation")
  const cleanStepName = stepName.replace(/\.iter_\d+\./, '.').replace(/\.iter_\d+$/, '');

  // Extract the base step name (remove .input/.output suffixes and loop iterations)
  const baseStepName = cleanStepName.split('.').pop() || stepName;

  // Find matching phase in the workflow graph
  let matchingNode = null;

  // First, try exact match
  matchingNode = workflowGraph.nodes.find(node => {
    const nodeId = node.id.toLowerCase();
    const stepLower = baseStepName.toLowerCase();

    if (nodeId === stepLower) {
      return true;
    }
    return false;
  });

  // If no exact match, try more specific matching for loop iterations
  if (!matchingNode) {
    // For steps like "implementation_verification_loop.iter_0.implementation"
    // Try to match to "implementation" instead of "implementation_verification_loop"
    if (stepName.includes('.iter_') && (baseStepName === 'implementation' || baseStepName === 'verification')) {
      matchingNode = workflowGraph.nodes.find(node =>
        node.id.toLowerCase() === baseStepName.toLowerCase()
      );
    }
  }

  // If still no match, try partial matching (but be more careful)
  if (!matchingNode) {
    matchingNode = workflowGraph.nodes.find(node => {
      const nodeId = node.id.toLowerCase();
      const stepLower = baseStepName.toLowerCase();

      // Avoid matching placeholders
      if (nodeId.includes('_placeholder')) {
        return false;
      }

      // Partial match for complex step names
      if (nodeId.includes(stepLower) || stepLower.includes(nodeId)) {
        return true;
      }

      return false;
    });
  }

  return matchingNode?.id || null;
}

// Count steps by input/output logic (same as phases)
function countStepsByStatus(workflows: WorkflowData[]): CurrentPhaseDetail {
  let completedSteps = 0;
  let activeSteps = 0;
  let failedSteps = 0;

  // Track step states for detailed logging
  const stepStatusList: Array<{ name: string; hasInput: boolean; hasOutput: boolean; level: string; finalStatus: string }> = [];

  // Group all steps and their expanded children to analyze input/output
  const allSteps: Array<{ stepName: string; status: string; level: string; parentStep?: string }> = [];

  function collectAllSteps(workflows: WorkflowData[]) {
    for (const workflow of workflows) {
      for (const step of workflow.steps) {
        // Add main step
        allSteps.push({
          stepName: step.stepName,
          status: step.status || 'unknown',
          level: 'main'
        });

        // Add expanded execution steps
        if (step.expandedExecutions) {
          for (const execution of step.expandedExecutions) {
            for (const subStep of execution.steps || []) {
              allSteps.push({
                stepName: subStep.stepName,
                status: subStep.status || 'unknown',
                level: 'execution',
                parentStep: step.stepName
              });
            }
          }
        }

        // Add expanded workflow steps
        if (step.expandedWorkflows) {
          for (const expandedWorkflow of step.expandedWorkflows) {
            for (const subStep of expandedWorkflow.steps || []) {
              allSteps.push({
                stepName: subStep.stepName,
                status: subStep.status || 'unknown',
                level: 'workflow',
                parentStep: step.stepName
              });
            }
          }
        }
      }
    }
  }

  collectAllSteps(workflows);

  // Group steps by name to analyze input/output pattern
  const stepGroups = new Map<string, Array<{ status: string; level: string; parentStep?: string }>>();

  for (const step of allSteps) {
    // Skip framework internal steps
    if (step.stepName === 'framework_error' || step.stepName === 'assistant_message') {
      continue;
    }

    if (!stepGroups.has(step.stepName)) {
      stepGroups.set(step.stepName, []);
    }
    stepGroups.get(step.stepName)!.push(step);
  }

  // Analyze each step group for input/output pattern
  for (const [stepName, stepInstances] of stepGroups.entries()) {
    let hasInput = false;
    let hasOutput = false;
    let hasFailed = false;

    // Analyze the step instances to determine input/output state
    for (const instance of stepInstances) {
      // Check for different status types
      if (instance.status.toLowerCase() === 'failed') {
        hasFailed = true;
      }

      // Determine if this represents input or output
      const stepNameLower = stepName.toLowerCase();
      const isInputStep = !stepNameLower.includes('.output') && !stepNameLower.includes('.final_result');
      const isOutputStep = stepNameLower.includes('.output') ||
                          stepNameLower.includes('.final_result') ||
                          instance.status.toLowerCase() === 'completed';

      if (isInputStep) {
        hasInput = true;
      }

      if (isOutputStep && instance.status.toLowerCase() === 'completed') {
        hasOutput = true;
      }
    }

    // Determine final step status using input/output logic
    let finalStatus: string;
    if (hasFailed) {
      finalStatus = 'FAILED';
      failedSteps++;
    } else if (hasInput && hasOutput) {
      finalStatus = 'COMPLETED';
      completedSteps++;
    } else if (hasInput && !hasOutput) {
      finalStatus = 'RUNNING';
      activeSteps++;
    } else {
      finalStatus = 'PENDING';
    }

    stepStatusList.push({
      name: stepName,
      hasInput,
      hasOutput,
      level: stepInstances[0].level,
      finalStatus
    });
  }

  return { completedSteps, activeSteps, failedSteps };
}

// Get workflow progress for a ticket
export async function getWorkflowProgress(workflowType: string, workflows: WorkflowData[]): Promise<StepCompletion> {
  // Default response for tickets with no workflows
  if (!workflows || workflows.length === 0) {
    return {
      workflowPhases: {
        totalPhases: 0,
        completedPhases: 0,
        currentPhase: null,
        percentComplete: 0
      },
      currentPhaseDetail: {
        completedSteps: 0,
        activeSteps: 0,
        failedSteps: 0
      }
    };
  }

  // Get current phase detail (always calculate this from execution data)
  const currentPhaseDetail = countStepsByStatus(workflows);

  // Try to get workflow graph for phase-level progress
  const workflowGraph = await fetchWorkflowGraph(workflowType);

  if (!workflowGraph) {
    // Fallback: no phase-level progress available
    return {
      workflowPhases: {
        totalPhases: 0,
        completedPhases: 0,
        currentPhase: null,
        percentComplete: 0
      },
      currentPhaseDetail
    };
  }

  // Filter out placeholder nodes (parallel workflow placeholders)
  const realPhases = workflowGraph.nodes.filter(node => !node.id.includes('_placeholder'));

  // Map execution steps to phases and determine completion
  const phaseStatus = new Map<string, boolean>();
  const currentPhases = new Set<string>();

  // Initialize phaseStatus for all real phases first (for percentage calculation)
  for (const node of realPhases) {
    phaseStatus.set(node.id, false);
  }

  // Analyze execution steps to determine phase completion
  // Group steps by phase and track input/output status
  const phaseSteps = new Map<string, { hasInput: boolean; hasOutput: boolean; steps: any[] }>();

  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      const phase = mapStepToPhase(step.stepName, workflowGraph);

      if (phase && !phase.includes('_placeholder')) {
        // Initialize phase tracking if not exists
        if (!phaseSteps.has(phase)) {
          phaseSteps.set(phase, { hasInput: false, hasOutput: false, steps: [] });
        }

        const phaseData = phaseSteps.get(phase)!;
        phaseData.steps.push(step);

        // Determine if this step represents input or output for the phase
        const stepNameLower = step.stepName.toLowerCase();
        const isInputStep = stepNameLower.includes('.input') ||
                           (!stepNameLower.includes('.output') && !stepNameLower.includes('.final_result'));
        const isOutputStep = stepNameLower.includes('.output') ||
                            stepNameLower.includes('.final_result') ||
                            step.status === 'completed';

        if (isInputStep) {
          phaseData.hasInput = true;
        }

        if (isOutputStep && step.status === 'completed') {
          phaseData.hasOutput = true;
        }
      }
    }
  }

  // Determine phase status based on input/output logic
  for (const [phaseId, phaseData] of phaseSteps.entries()) {
    const { hasInput, hasOutput } = phaseData;

    if (hasInput && hasOutput) {
      // Phase is completed
      phaseStatus.set(phaseId, true);
    } else if (hasInput && !hasOutput) {
      // Phase is running
      phaseStatus.set(phaseId, false);
      currentPhases.add(phaseId);
    } else {
      // Phase is pending
      phaseStatus.set(phaseId, false);
    }
  }

  const completedPhases = Array.from(phaseStatus.values()).filter(completed => completed).length;
  const currentPhase = currentPhases.size > 0 ? Array.from(currentPhases)[0] : null;
  const percentComplete = realPhases.length > 0 ? Math.round((completedPhases / realPhases.length) * 100) : 0;

  return {
    workflowPhases: {
      totalPhases: realPhases.length,
      completedPhases,
      currentPhase,
      percentComplete
    },
    currentPhaseDetail
  };
}


// Get step completion data for multiple tickets
export async function getStepCompletionForTickets(
  ticketsWithWorkflows: Array<{ id: string; workflowType: string; workflows: WorkflowData[] }>
): Promise<Record<string, StepCompletion>> {
  const result: Record<string, StepCompletion> = {};

  // Process each ticket
  for (const ticket of ticketsWithWorkflows) {
    result[ticket.id] = await getWorkflowProgress(ticket.workflowType, ticket.workflows);
  }

  return result;
}