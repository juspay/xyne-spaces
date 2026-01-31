// Dynamic workflow executor that runs workflows with mock engine for graph generation
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import {
  WorkflowEngine,
  BaseWorkflowContext,
  WorkflowState,
  AnyEnum,
  CheckpointHandler,
  ConditionalHandler,
  ExternalStepHandler,
  ExternalResponseProcessor,
  ExternalStepMetadata,
  WhileLoopBodyFunction,
  ParallelWorkflowConfig,
  AgenticCheckpointConfig,
  AgenticCheckpointResult,
  LoopControl
} from '../workflow-types';
import {logger} from '@/utils/logger';

// Internal types for graph generation
interface WorkflowGraphNode {
  id: string;
  name: string;
  type: 'checkpoint' | 'agent' | 'conditional' | 'external' | 'loop';
  position?: { x: number; y: number };
}

interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'conditional-true' | 'conditional-false' | 'loop' | 'parallel-child' | 'loop-entry' | 'loop-back' | 'parallel' | 'parallel-join';
}

interface WorkflowGraph {
  workflowType: string;
  name: string;
  description: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

interface TrackedStep {
  id: string;
  name: string;
  type: 'checkpoint' | 'agent' | 'conditional' | 'external' | 'loop';
  conditionalResult?: boolean;
  position?: { x: number; y: number };
  childWorkflows?: Array<{workflowType: string, initialContext: any}>;
}

// Configuration for mock conditional outcomes
interface MockConditionalConfig {
  [stepId: string]: boolean;
}

// Default conditional configurations for common patterns
// const _DEFAULT_CONDITIONAL_CONFIGS: Record<string, MockConditionalConfig> = {
//   'BUG_WORKFLOW': {
//     'should_validate': true,
//     'is_acceptable': false,
//     'is_config_change': false
//   },
//   'USER_ONBOARDING': {
//     'check_premium_user': true
//   },
//   'FEATURE_IMPLEMENTATION': {
//     'needs_approval': true,
//     'has_tests': true
//   }
// };

// Internal Mock Workflow Tracker
class InternalMockTracker {
  private steps: TrackedStep[] = [];
  private edges: WorkflowGraphEdge[] = [];
  private lastStepId: string | null = null;
  private stepCounter = 0;
  private parallelGroups: Map<string, string[]> = new Map();

  addStep(id: string, type: TrackedStep['type'], conditionalResult?: boolean, isChildWorkflow: boolean = false): TrackedStep {
    const step: TrackedStep = {
      id,
      name: this.formatStepName(id),
      type,
      conditionalResult,
      position: { x: 250, y: this.stepCounter * 100 }
    };

    this.steps.push(step);
    this.stepCounter++;

    // Create edge from previous step (but not for child workflows or if previous step has parallel children)
    if (this.lastStepId && !isChildWorkflow && !this.hasParallelChildren(this.lastStepId)) {
      this.edges.push({
        id: `${this.lastStepId}-${id}`,
        source: this.lastStepId,
        target: id,
        type: 'default'
      });
    }

    // Update lastStepId (but not for child workflows)
    if (type !== 'conditional' && !isChildWorkflow) {
      this.lastStepId = id;
    }

    return step;
  }

  getWorkflowGraph(workflowType: string, name: string, description: string): WorkflowGraph {
    // Update edges for parallel groups before generating the graph
    this.updateEdgesForParallel();

    const nodes: WorkflowGraphNode[] = this.steps.map(step => ({
      id: step.id,
      name: step.name,
      type: step.type,
      position: step.position
    }));

    return {
      workflowType,
      name,
      description,
      nodes,
      edges: this.edges
    };
  }

  // Get steps that contain child workflows for recursive expansion
  getStepsWithChildWorkflows(): TrackedStep[] {
    return this.steps.filter(step => step.childWorkflows && step.childWorkflows.length > 0);
  }

  private formatStepName(stepId: string): string {
    return stepId
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  getStepCount(): number {
    return this.steps.length;
  }

  addEdge(sourceId: string, targetId: string, type: string = 'default'): void {
    this.edges.push({
      id: `${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      type: type as any
    });
  }

  getStepsAfter(stepId: string): TrackedStep[] {
    const stepIndex = this.steps.findIndex(step => step.id === stepId);
    if (stepIndex === -1) return [];
    return this.steps.slice(stepIndex + 1);
  }

  setParallelGroup(parallelId: string, childIds: string[]): void {
    this.parallelGroups.set(parallelId, childIds);
  }

  getParallelChildren(parallelId: string): string[] {
    return this.parallelGroups.get(parallelId) || [];
  }

  hasParallelChildren(stepId: string): boolean {
    return this.parallelGroups.has(stepId);
  }

  getLastStepId(): string | null {
    return this.lastStepId;
  }

  updateEdgesForParallel(): void {
    // After all steps are added, create proper edges for parallel groups
    for (const [parallelId, childIds] of this.parallelGroups) {
      // Find the step before the parallel group
      const parallelStepIndex = this.steps.findIndex(step =>
        this.getParallelChildren(parallelId).includes(step.id)
      );

      if (parallelStepIndex > 0) {
        const previousStep = this.steps[parallelStepIndex - 1];

        // Connect previous step to all parallel children
        for (const childId of childIds) {
          this.addEdge(previousStep.id, childId, 'parallel');
        }
      }

      // Find the step after the parallel group
      const lastChildIndex = Math.max(...childIds.map(childId =>
        this.steps.findIndex(step => step.id === childId)
      ));

      if (lastChildIndex < this.steps.length - 1) {
        const nextStep = this.steps[lastChildIndex + 1];

        // Connect all parallel children to next step
        for (const childId of childIds) {
          this.addEdge(childId, nextStep.id, 'parallel-join');
        }
      }
    }
  }
}

// Internal Mock Engine
class InternalMockEngine<TContext extends BaseWorkflowContext, TEnum extends AnyEnum = AnyEnum> implements WorkflowEngine<TContext, TEnum> {
  private context: Readonly<TContext>;
  private tracker: InternalMockTracker;
  private conditionalConfig: MockConditionalConfig;
  private discoveredConditionals: Set<string> = new Set();
  private isDiscoveryMode: boolean = false;

  constructor(context: TContext, tracker: InternalMockTracker, conditionalConfig: MockConditionalConfig = {}, isDiscoveryMode: boolean = false) {
    this.context = context;
    this.tracker = tracker;
    this.conditionalConfig = conditionalConfig;
    this.isDiscoveryMode = isDiscoveryMode;
  }

  getDiscoveredConditionals(): string[] {
    return Array.from(this.discoveredConditionals);
  }

  getContext(): Readonly<TContext> {
    return this.context;
  }

  async createCheckpoint<R, Args extends unknown[]>(
    id: TEnum[keyof TEnum],
    handler: CheckpointHandler<R, Args>,
    ...args: Args
  ): Promise<R> {
    void handler; void args; // Suppress unused warnings
    const stepId = String(id) // Convert enum value to string

    this.tracker.addStep(stepId, 'checkpoint');

    // For specific checkpoints that update context, simulate the updates
    // We need to modify the context object directly since it's readonly
    const mutableContext = this.context as any;

    if (stepId === 'multi_repo_coe_analysis') {
      // Simulate multi-repo analysis by updating the context
      const mockMultiRepoAnalysis = {
        repos: [
          {
            repo: 'euler-api-customer',
            changes: 'Mock code changes for testing'
          },
          {
            repo: 'euler-ui-web',
            changes: 'Mock UI changes for testing'
          }
        ]
      };
      mutableContext.multi_repo_coe_analysis = mockMultiRepoAnalysis;
      logger.info('🔄 Mock: Added multi_repo_coe_analysis to context');
    }

    if (stepId === 'repository_setup') {
      // Simulate repository setup by updating the context based on multi_repo_coe_analysis
      const multiRepoAnalysis = mutableContext.multi_repo_coe_analysis;
      logger.info('🔄 Mock: repository_setup called, multi_repo_coe_analysis:', multiRepoAnalysis);
      if (multiRepoAnalysis && multiRepoAnalysis.repos) {
        const mockRepositorySetups = multiRepoAnalysis.repos.map((repo: any) => ({
          targetRepository: repo.repo,
          repoUrl: `ssh://git@mock-${repo.repo}.git`,
          branch: `mock-bugfix-${mutableContext.bugId || 'test'}-${repo.repo}`,
          setupAt: new Date().toISOString()
        }));
        mutableContext.repositorySetups = mockRepositorySetups;
        logger.info('🔄 Mock: Added repositorySetups to context:', mockRepositorySetups.length, 'repositories');
        logger.info('🔄 Mock: repositorySetups content:', mockRepositorySetups);
      } else {
        logger.info('🔄 Mock: No multi_repo_coe_analysis found, cannot setup repositories');
      }
    }
    mutableContext.problemStatement = {};
    mutableContext.rca = {};
    mutableContext.coe = '';
    return mutableContext;
  }

  async createAgenticCheckpoint(
    id: TEnum[keyof TEnum],
    name: string,
    config: AgenticCheckpointConfig,
    parentStepId?: string
  ): Promise<AgenticCheckpointResult> {
    void name; void config; void parentStepId;
    const stepId = String(id) // Convert enum value to string

    this.tracker.addStep(stepId, 'agent');
    
    return Promise.resolve({
      result: {
        messages: [],
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        toolExecutions: [],
        metrics: {
          duration: 1000,
          tokensPerSecond: 0,
          totalDuration: 1000,
          llmCalls: 1,
          totalTokens: 100,
          toolExecutions: 0,
          inputTokens: 50,
          outputTokens: 50,
          cacheHits: 0,
          cacheWrites: 0,
          averageToolDuration: 0,
          conversationTurns: 1,
          startTime: new Date(),
          endTime: new Date()
        },
        status: 'completed' as const
      },
      gitInfo: {
        branch: 'mock-branch',
        commitHash: 'mock-commit-hash',
        repoUrl: 'mock-repo-url',
        pullRequestUrl: undefined,
        pr_link: undefined,
        hasCommits: true
      }
    });
  }


  async createConditionalStep<Args extends unknown[]>(
    id: TEnum[keyof TEnum],
    condition: ConditionalHandler<Args>,
    ...args: Args
  ): Promise<boolean> {
    void condition; void args; // Suppress unused warnings
    const stepId = String(id) // Convert enum value to string

    // Always track discovered conditionals
    this.discoveredConditionals.add(stepId);

    let result: boolean;
    if (this.isDiscoveryMode) {
      // In discovery mode, default to false to follow one path but record all conditionals
      result = false;
    } else {
      // In execution mode, use provided config
      result = this.conditionalConfig[stepId] ?? false;
    }


    this.tracker.addStep(stepId, 'conditional', result);
    
    return Promise.resolve(result);
  }

  async createExternalStep<R, Args extends unknown[]>(
    id: TEnum[keyof TEnum],
    metadata: ExternalStepMetadata,
    requestHandler: ExternalStepHandler<Args>,
    responseProcessor: ExternalResponseProcessor<R>,
    ...args: Args
  ): Promise<R> {
    void metadata; void requestHandler; void responseProcessor; void args; // Suppress unused warnings
    const stepId = String(id) // Convert enum value to string

    this.tracker.addStep(stepId, 'external');

    const mockResponse = { approved: true, isApproved: true };
    return Promise.resolve(mockResponse as R);
  }

  async createWhileLoop(
    id: TEnum[keyof TEnum],
    _maxIterations: number,
    body: WhileLoopBodyFunction<TContext, TEnum>,
    parentStepId?: string
  ): Promise<void> {
    void parentStepId; // Suppress unused warnings
    const stepId = String(id) // Convert enum value to string

    // Add the main loop step - this will always succeed even if body execution fails
    const loopStep = this.tracker.addStep(stepId, 'loop');


    // Create a mock scoped engine for the loop body
    const scopedEngine = new InternalMockEngine<TContext, TEnum>(this.context, this.tracker, this.conditionalConfig);

    // Execute the loop body once to capture the internal steps
    try {

      await body(0, scopedEngine);

      // After executing the body, we need to create the loop-back connections
      // Find steps that were added during the loop execution
      const loopSteps = this.tracker.getStepsAfter(loopStep.id);

      if (loopSteps.length > 0) {
        // Connect loop entry to first loop step
        this.tracker.addEdge(stepId, loopSteps[0].id, 'loop-entry');

        // Connect last loop step back to first loop step (loop-back)
        const lastLoopStep = loopSteps[loopSteps.length - 1];
        this.tracker.addEdge(lastLoopStep.id, loopSteps[0].id, 'loop-back');


      }
    } catch (error) {
      logger.warn(`⚠️ Loop body execution failed for ${stepId}, but loop step registered:`, error);

      // Even if the loop body fails, we can still show the loop exists
      // Add a placeholder step inside the loop to indicate it has content
      const placeholderStep = this.tracker.addStep(`${stepId}_placeholder`, 'checkpoint');
      placeholderStep.name = `${this.formatStepName(stepId)} (Complex Logic)`;

      // Connect loop to placeholder
      this.tracker.addEdge(stepId, `${stepId}_placeholder`, 'loop-entry');
      // Connect placeholder back to itself to show it's a loop
      this.tracker.addEdge(`${stepId}_placeholder`, `${stepId}_placeholder`, 'loop-back');
    }


    return Promise.resolve();
  }

  private formatStepName(stepId: string): string {
    return stepId
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  async createParallelWorkflows<
    const Tasks extends readonly import('../workflow-types').ValidatedWorkflowTask[],
    TFinalResult = void
  >(
    id: TEnum[keyof TEnum],
    config: ParallelWorkflowConfig<Tasks, TFinalResult>,
    parentStepId?: string
  ): Promise<TFinalResult> {
    void parentStepId; // Suppress unused warnings
    const stepId = String(id) // Convert enum value to string

    // Add the main parallel step to track child workflow information
    const parallelStep = this.tracker.addStep(stepId, 'checkpoint', undefined, false);

    // Store child workflow information in the parallel step
    parallelStep.childWorkflows = config.workflows.map(workflow => ({
      workflowType: workflow.workflowType,
      initialContext: workflow.initialContext
    }));




    // Store the parallel step info for edge management
    const childIds = config.workflows.map((workflow, index) =>
      `${String(workflow.workflowType).toLowerCase()}_child_${index}`
    );
    this.tracker.setParallelGroup(stepId, childIds);



    // Mock parallel workflow results - create proper ConversationResult structure
    const mockResults = config.workflows.map((workflow, index) => ({
      executionId: `mock-child-exec-${index}`,
      workflowType: workflow.workflowType,
      result: {
        messages: [
          {
            role: 'assistant',
            content: `Mock ${String(workflow.workflowType)} planning result: This is a comprehensive plan for implementing the ${String(workflow.workflowType)} component.`
          }
        ],
        totalTokens: 100,
        inputTokens: 50,
        outputTokens: 50,
        toolExecutions: [],
        metrics: { duration: 1000, tokensPerSecond: 0.05 },
        status: 'completed'
      },
      status: 'completed' as const
    }));

    // Call callbacks
    for (const result of mockResults) {
      const control = await config.onExecutionComplete(result as unknown as import('../workflow-types').WorkflowResultUnion<Tasks>);
      if (control === LoopControl.BREAK) break;
    }

    if (config.onAllCompleted) {
      return await config.onAllCompleted(mockResults as import('../workflow-types').WorkflowResultTuple<Tasks>);
    }

    return Promise.resolve({} as TFinalResult);
  }

  getCurrentState(): WorkflowState<TContext> {
    return {
      workflowId: 'mock-workflow-id',
      workflowExecutionId: 'mock-execution-id',
      context: this.context
    };
  }

  getWorkflowId(): string {
    return 'mock-workflow-id';
  }

  getWorkflowExecutionId(): string {
    return 'mock-execution-id';
  }

  getPendingAgenticResults(): Array<{
    checkpointId: string
    result: import('@framework').ConversationResult
    gitInfo: import('../workflow-types').GitInfo
  }> {
    // Mock engine doesn't track pending agentic results
    return [];
  }
}

interface WorkflowMetadata {
  workflowType: string;
  name: string;
  description: string;
  contextInterface: string;
}

// Utility to generate all possible combinations of boolean values for conditionals
function generateConditionalCombinations(conditionals: string[]): MockConditionalConfig[] {
  if (conditionals.length === 0) return [{}];

  const combinations: MockConditionalConfig[] = [];
  const totalCombinations = Math.pow(2, conditionals.length);

  for (let i = 0; i < totalCombinations; i++) {
    const config: MockConditionalConfig = {};
    conditionals.forEach((conditional, index) => {
      // Use bit manipulation to determine true/false for each conditional
      config[conditional] = Boolean((i >> index) & 1);
    });
    combinations.push(config);
  }

  return combinations;
}

export class DynamicWorkflowExecutor {
  private sourceFile: ts.SourceFile | null = null;
  private graphCache: Map<string, WorkflowGraph> = new Map();

  /**
   * Clear the workflow graph cache (useful for development/testing)
   */
  clearCache(): void {
    this.graphCache.clear();
    
  }

  /**
   * Execute a workflow file dynamically with mock engine to generate graph
   */
  async executeWorkflowForGraph(filePath: string, workflowType: string, authToken?: string): Promise<WorkflowGraph> {
    try {
      // Check cache first - return cached graph if available
      const cacheKey = workflowType.toLowerCase();
      if (this.graphCache.has(cacheKey)) {
        
        return this.graphCache.get(cacheKey)!;
      }

      
      // Clear cache for this session to ensure fresh results (for testing)
      // this.graphCache.clear();
      // Step 1: Parse the file to extract metadata
      const metadata = await this.extractWorkflowMetadata(filePath);

      // Step 2: Load the workflow module dynamically
      const workflowModule = await this.loadWorkflowModule(filePath);

      // Step 3: Find the workflow definition
      const workflowDefinition = this.findWorkflowDefinition(workflowModule, workflowType);

      if (!workflowDefinition) {
        throw new Error(`Workflow definition not found for type: ${workflowType}`);
      }

      // Step 4: Create mock context based on the workflow type
      const mockContext = this.createMockContext(workflowType);

      // Step 5: PHASE 1 - Discovery Phase: Find all conditionals
      
      const discoveryTracker = new InternalMockTracker();
      const discoveryEngine = new InternalMockEngine(mockContext, discoveryTracker, {}, true); // isDiscoveryMode = true

      try {
        await workflowDefinition.execute(discoveryEngine);
      } catch (error) {
        logger.warn('⚠️ Discovery phase had expected errors:', error);
      }

      const discoveredConditionals = discoveryEngine.getDiscoveredConditionals();
      

      // Step 6: PHASE 2 - Multi-Path Execution: Execute all combinations
      
      const combinations = generateConditionalCombinations(discoveredConditionals);
      

      const masterTracker = new InternalMockTracker();
      const allExecutionResults: Array<{config: MockConditionalConfig, tracker: InternalMockTracker}> = [];

      for (let i = 0; i < combinations.length; i++) {
        const config = combinations[i];
        

        const pathTracker = new InternalMockTracker();
        const pathEngine = new InternalMockEngine(mockContext, pathTracker, config, false);

        try {
          await workflowDefinition.execute(pathEngine);
          allExecutionResults.push({config, tracker: pathTracker});
          
        } catch (error) {
          logger.warn(`⚠️ Combination ${i + 1} had expected errors:`, error);
          // Still include partial results
          allExecutionResults.push({config, tracker: pathTracker});
        }
      }

      // Step 7: Merge all execution results into master tracker
      
      this.mergeExecutionResults(masterTracker, allExecutionResults, discoveredConditionals);

      

      // Step 8: Recursively expand child workflows
      
      const finalGraph = await this.expandChildWorkflows(masterTracker, workflowType, metadata, authToken);

      // Step 9: Cache the generated graph for future requests
      this.graphCache.set(cacheKey, finalGraph);
      

      
      return finalGraph;
    } catch (error) {
      logger.error('Error in dynamic workflow execution:', error);
      throw error;
    }
  }

  /**
   * Merge execution results from multiple conditional paths into a master tracker
   */
  private mergeExecutionResults(
    masterTracker: InternalMockTracker,
    allResults: Array<{config: MockConditionalConfig, tracker: InternalMockTracker}>,
    discoveredConditionals: string[]
  ): void {
    const allNodes = new Map<string, TrackedStep>();
    const conditionalBranches = new Map<string, {trueTargets: Set<string>, falseTargets: Set<string>}>();

    // Initialize conditional branch tracking
    discoveredConditionals.forEach(conditional => {
      conditionalBranches.set(conditional, {trueTargets: new Set(), falseTargets: new Set()});
    });

    // Step 1: Collect all unique nodes from all executions
    allResults.forEach(({config, tracker}) => {
      const trackerSteps = (tracker as any).steps as TrackedStep[]; // Access private steps
      trackerSteps.forEach(step => {
        if (!allNodes.has(step.id)) {
          allNodes.set(step.id, step);
        }
      });

      // Step 2: Track conditional branch relationships
      trackerSteps.forEach((step, index) => {
        if (step.type === 'conditional' && discoveredConditionals.includes(step.id)) {
          const conditionalResult = config[step.id];
          const branchInfo = conditionalBranches.get(step.id)!;

          // Find the next step after this conditional
          if (index + 1 < trackerSteps.length) {
            const nextStep = trackerSteps[index + 1];
            if (conditionalResult) {
              branchInfo.trueTargets.add(nextStep.id);
            } else {
              branchInfo.falseTargets.add(nextStep.id);
            }
          }
        }
      });
    });

    // Step 3: Add all nodes to master tracker
    let stepCounter = 0;
    allNodes.forEach(step => {
      const masterStep = masterTracker.addStep(step.id, step.type, step.conditionalResult);
      masterStep.position = { x: 250, y: stepCounter * 100 };

      // Preserve childWorkflows property if it exists
      if (step.childWorkflows) {
        masterStep.childWorkflows = step.childWorkflows;
        
      }

      stepCounter++;
    });

    // Step 4: Create conditional edges based on discovered branches
    conditionalBranches.forEach((branchInfo, conditionalId) => {
      // Create conditional-true edges
      branchInfo.trueTargets.forEach(targetId => {
        masterTracker.addEdge(conditionalId, targetId, 'conditional-true');
      });

      // Create conditional-false edges
      branchInfo.falseTargets.forEach(targetId => {
        masterTracker.addEdge(conditionalId, targetId, 'conditional-false');
      });
    });

    // Step 5: Add remaining default edges (non-conditional connections)
    allResults.forEach(({tracker}) => {
      const trackerEdges = (tracker as any).edges as WorkflowGraphEdge[]; // Access private edges
      trackerEdges.forEach(edge => {
        // Only add if not already a conditional edge
        const isConditionalEdge = discoveredConditionals.includes(edge.source);
        if (!isConditionalEdge && edge.type !== 'conditional-true' && edge.type !== 'conditional-false') {
          // Check if this edge doesn't already exist to avoid duplicates
          const existingEdges = (masterTracker as any).edges as WorkflowGraphEdge[];
          const edgeExists = existingEdges.some(existingEdge =>
            existingEdge.source === edge.source && existingEdge.target === edge.target
          );
          if (!edgeExists) {
            masterTracker.addEdge(edge.source, edge.target, edge.type || 'default');
          }
        }
      });
    });

    
  }

  /**
   * Recursively expand child workflows and embed them into the parent graph
   */
  private async expandChildWorkflows(
    masterTracker: InternalMockTracker,
    workflowType: string,
    metadata: WorkflowMetadata,
    authToken?: string
  ): Promise<WorkflowGraph> {
    const baseGraph = masterTracker.getWorkflowGraph(
      workflowType.toLowerCase(),
      metadata.name || 'Unknown Workflow',
      metadata.description || 'No description available'
    );

    // Find steps with child workflows
    const stepsWithChildren = masterTracker.getStepsWithChildWorkflows();

    
    

    if (stepsWithChildren.length === 0) {
      
      return baseGraph;
    }

    

    // Start with base graph nodes and edges
    const expandedNodes = [...baseGraph.nodes];
    const expandedEdges = [...baseGraph.edges];
    baseGraph.nodes.length;

    // Process each step that has child workflows
    for (const parentStep of stepsWithChildren) {
      

      // Remove the parent parallel container from final graph
      const parentNodeIndex = expandedNodes.findIndex(node => node.id === parentStep.id);
      if (parentNodeIndex !== -1) {
        expandedNodes.splice(parentNodeIndex, 1);
      }

      // Process each child workflow
      for (let childIndex = 0; childIndex < parentStep.childWorkflows!.length; childIndex++) {
        const childWorkflow = parentStep.childWorkflows![childIndex];
        const childWorkflowType = childWorkflow.workflowType;

        

        // Check cache first
        let childGraph: WorkflowGraph;
        if (this.graphCache.has(childWorkflowType)) {
          
          childGraph = this.graphCache.get(childWorkflowType)!;
        } else {
          
          try {
            // Make HTTP call to the existing API endpoint
            childGraph = await this.fetchWorkflowGraphViaAPI(childWorkflowType, authToken);
            this.graphCache.set(childWorkflowType, childGraph);
            
          } catch (error) {
            logger.warn(`⚠️ Failed to fetch graph for ${childWorkflowType} via API:`, error);
            childGraph = this.createPlaceholderGraph(childWorkflowType);
          }
        }

        // Embed child graph nodes with unique IDs and positioning
        const childNodePrefix = `${parentStep.id}_child_${childIndex}`;
        const baseX = (parentStep.position?.x || 250) + (childIndex * 300); // Horizontal spacing
        const baseY = (parentStep.position?.y || 0) + 100; // Vertical offset

        for (let nodeIndex = 0; nodeIndex < childGraph.nodes.length; nodeIndex++) {
          const childNode = childGraph.nodes[nodeIndex];
          const newNodeId = `${childNodePrefix}_${childNode.id}`;

          expandedNodes.push({
            id: newNodeId,
            name: `${childNode.name} (${childWorkflowType})`,
            type: childNode.type,
            position: {
              x: baseX,
              y: baseY + (nodeIndex * 80) // Vertical stacking within child
            }
          });
        }

        // Embed child graph edges with updated IDs
        for (const childEdge of childGraph.edges) {
          const newEdgeId = `${childNodePrefix}_${childEdge.id}`;
          const newSourceId = `${childNodePrefix}_${childEdge.source}`;
          const newTargetId = `${childNodePrefix}_${childEdge.target}`;

          expandedEdges.push({
            id: newEdgeId,
            source: newSourceId,
            target: newTargetId,
            label: childEdge.label,
            type: childEdge.type || 'default'
          });
        }

        // Connect parent step's incoming edges to first child node (if exists)
        if (childGraph.nodes.length > 0) {
          const firstChildNodeId = `${childNodePrefix}_${childGraph.nodes[0].id}`;
          const lastChildNodeId = `${childNodePrefix}_${childGraph.nodes[childGraph.nodes.length - 1].id}`;

          // For the FIRST child workflow, redirect incoming edges from parent
          if (childIndex === 0) {
            const incomingEdges = expandedEdges.filter(edge => edge.target === parentStep.id);
            for (const edge of incomingEdges) {
              edge.target = firstChildNodeId;
              edge.type = 'parallel';
            }
          } else {
            // For subsequent child workflows, create new parallel edges from the same source
            const incomingEdges = expandedEdges.filter(edge => edge.type === 'parallel');
            if (incomingEdges.length > 0) {
              const sourceNode = incomingEdges[0].source; // Get the source of parallel edges
              expandedEdges.push({
                id: `${sourceNode}-${firstChildNodeId}`,
                source: sourceNode,
                target: firstChildNodeId,
                type: 'parallel'
              });
            }
          }

          // For the FIRST child workflow, redirect outgoing edges from parent
          if (childIndex === 0) {
            const outgoingEdges = expandedEdges.filter(edge => edge.source === parentStep.id);
            for (const edge of outgoingEdges) {
              edge.source = lastChildNodeId;
              edge.type = 'parallel-join';
            }
          } else {
            // For subsequent child workflows, create new parallel-join edges to the same target
            const outgoingEdges = expandedEdges.filter(edge => edge.type === 'parallel-join');
            if (outgoingEdges.length > 0) {
              const targetNode = outgoingEdges[0].target; // Get the target of parallel-join edges
              expandedEdges.push({
                id: `${lastChildNodeId}-${targetNode}`,
                source: lastChildNodeId,
                target: targetNode,
                type: 'parallel-join'
              });
            }
          }
        }
      }
    }


    return {
      workflowType: baseGraph.workflowType,
      name: baseGraph.name,
      description: baseGraph.description,
      nodes: expandedNodes,
      edges: expandedEdges
    };
  }

  /**
   * Create a placeholder graph for workflows that can't be found
   */
  private createPlaceholderGraph(workflowType: string): WorkflowGraph {
    return {
      workflowType: workflowType.toLowerCase(),
      name: `${workflowType} (Placeholder)`,
      description: `Placeholder for ${workflowType} workflow`,
      nodes: [{
        id: 'placeholder',
        name: `${workflowType} Placeholder`,
        type: 'checkpoint',
        position: { x: 0, y: 0 }
      }],
      edges: []
    };
  }

  /**
   * Fetch workflow graph via HTTP API call to existing endpoint
   */
  private async fetchWorkflowGraphViaAPI(workflowType: string, authToken?: string): Promise<WorkflowGraph> {
    const apiUrl = `http://localhost:3001/api/workflows/graph/${workflowType}`;

    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = authToken;
    }

    const response = await fetch(apiUrl, { headers });
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    const graph = await response.json() as WorkflowGraph;
    return graph;
  }

  // Note: findWorkflowFile method removed - now using API-based approach via fetchWorkflowGraphViaAPI

  /**
   * Extract workflow metadata from TypeScript file
   */
  private async extractWorkflowMetadata(filePath: string): Promise<WorkflowMetadata> {
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    this.sourceFile = ts.createSourceFile(
      path.basename(filePath),
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    let workflowType = '';
    let name = '';
    let description = '';

    const visit = (node: ts.Node) => {
      if (ts.isVariableStatement(node)) {
        const declaration = node.declarationList.declarations[0];
        if (declaration && ts.isVariableDeclaration(declaration)) {
          const varName = declaration.name.getText(this.sourceFile!);
          if (varName.toLowerCase().includes('workflow') && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
            // Extract metadata from workflow definition
            declaration.initializer.properties.forEach(prop => {
              if (ts.isPropertyAssignment(prop)) {
                const propName = prop.name.getText(this.sourceFile!);
                const value = prop.initializer;

                if (propName === 'type' && ts.isPropertyAccessExpression(value)) {
                  workflowType = value.name.getText(this.sourceFile!);
                } else if (propName === 'name' && ts.isStringLiteral(value)) {
                  name = value.text;
                } else if (propName === 'description' && ts.isStringLiteral(value)) {
                  description = value.text;
                }
              }
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    if (this.sourceFile) {
      visit(this.sourceFile);
    }

    return { workflowType, name, description, contextInterface: '' };
  }

  /**
   * Dynamically load workflow module
   */
  private async loadWorkflowModule(filePath: string): Promise<any> {
    try {
      // Convert to file URL for ES modules
      const fileUrl = `file://${path.resolve(filePath)}`;

      // Add cache busting parameter to avoid module caching
      const moduleUrl = `${fileUrl}?t=${Date.now()}`;

      const module = await import(moduleUrl);
      return module;
    } catch (error) {
      logger.error('Error loading workflow module:', error);
      throw new Error(`Failed to load workflow from ${filePath}: ${error}`);
    }
  }

  /**
   * Find workflow definition in loaded module
   */
  private findWorkflowDefinition(workflowModule: any, workflowType: string): any {
    // Look for exported workflow definitions
    const possibleNames = [
      `${workflowType.toLowerCase()}Workflow`,
      `${workflowType.toLowerCase()}`,
      'workflow',
      'default'
    ];

    for (const name of possibleNames) {
      if (workflowModule[name] && typeof workflowModule[name].execute === 'function') {
        return workflowModule[name];
      }
    }

    // Look for any exported object with execute method
    for (const [, value] of Object.entries(workflowModule)) {
      if (value && typeof value === 'object' && typeof (value as any).execute === 'function') {
        return value;
      }
    }

    return null;
  }

  /**
   * Create mock context based on workflow type
   */
  private createMockContext(workflowType: string): BaseWorkflowContext {
    const baseContext = {};

    switch (workflowType) {
      case 'BUG_WORKFLOW':
        // Create comprehensive mock context with all required dependencies
        const mockMultiRepoAnalysis = {
          repos: [
            {
              repo: 'euler-api-customer',
              changes: 'Mock code changes for testing'
            },
            {
              repo: 'euler-ui-web',
              changes: 'Mock UI changes for testing'
            }
          ]
        };

        const mockRepositorySetups = mockMultiRepoAnalysis.repos.map(repo => ({
          targetRepository: repo.repo,
          repoUrl: `ssh://git@mock-${repo.repo}.git`,
          branch: `mock-bugfix-mock-bug-123-${repo.repo}`,
          setupAt: new Date().toISOString()
        }));

        return {
          ...baseContext,
          bugId: 'mock-bug-123',
          title: 'Mock Bug Title',
          description: 'Mock bug description for testing',
          severity: 'medium',
          // Pre-populate all required context data
          multi_repo_coe_analysis: mockMultiRepoAnalysis,
          repositorySetups: mockRepositorySetups
        };

      case 'USER_ONBOARDING':
        return {
          ...baseContext,
          email: 'mock@example.com',
          userType: 'premium'
        };

      case 'FEATURE_IMPLEMENTATION':
        return {
          ...baseContext,
          featureId: 'mock-feature-123',
          title: 'Mock Feature',
          requirements: 'Mock feature requirements'
        };

      case 'XYNE_SPACES_FEATURE_IMPLEMENTATION':
        return {
          ...baseContext,
          ticketId: 'mock-ticket-123',
          title: 'Mock Xyne Spaces Feature',
          description: 'Mock feature description for Xyne Spaces',
          requirements: 'Mock feature requirements',
          repoUrl: 'https://github.com/mock-org/mock-repo.git',
          repoBranch: 'main'
        };

      case 'FIDO_SERVER_WORKFLOW':
        return {
          ...baseContext,
          ticketId: 'mock-fido-ticket-123',
          projectName: 'Mock FIDO Server',
          repositoryUrl: 'https://github.com/mock-org/fido-server.git',
          workspaceDirectory: '/tmp/mock-workspace',
          maxIterations: 3,
          model: 'mock-model',
          repoBranch: 'main'
        };

      default:
        return baseContext;
    }
  }
}
