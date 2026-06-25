// Dynamic workflow executor that runs workflows with mock engine for graph generation

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






    
    

