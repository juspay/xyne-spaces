/**
 * Workflow Graph Service Types
 * All type definitions for workflow graph operations and data structures
 */

import React from 'react';

// Enhanced type definitions to replace 'any' usage

// WorkflowNode data can contain various metadata
export interface WorkflowNodeData {
  label: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'not_executed';
  executorType?: string | undefined;
  executionStep?: WorkflowStep | undefined;
  duration?: string | undefined;
  externalStepType?: string | undefined;
  workflowExecutionId?: string | undefined;
  workflowStepId?: string | undefined;
  workflowStepIds?: string[] | undefined;
}

// WorkflowEdge data for edge-specific metadata
export interface WorkflowEdgeData {
  condition?: string;
  label?: string;
  priority?: number;
  [key: string]: unknown; // Allow additional properties with unknown type
}

// External metadata that can be present in step data
export interface ExternalMetadata {
  type?: string;
  approvalRequired?: boolean;
  timeout?: number;
  retryCount?: number;
  [key: string]: unknown;
}

// Structured step data that replaces the generic 'any'
export interface WorkflowStepData {
  externalMetadata?: ExternalMetadata;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: {
    message?: string;
    stack?: string;
    code?: string;
  };
  executionMetadata?: {
    startTime?: string;
    endTime?: string;
    duration?: number;
    retryCount?: number;
  };
  [key: string]: unknown; // Allow additional properties
}

// AST Graph Node structure from backend
export interface ASTGraphNode {
  id: string;
  name: string;
  type: 'checkpoint' | 'agent' | 'conditional' | 'external' | 'loop';
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
}

// AST Graph Edge structure from backend
export interface ASTGraphEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  condition?: string;
  metadata?: Record<string, unknown>;
}

// Complete AST Graph structure
export interface ASTGraph {
  nodes: ASTGraphNode[];
  edges: ASTGraphEdge[];
  metadata?: Record<string, unknown>;
}

// Execution metadata for attempt selector
export interface ExecutionMetadata {
  executionId: string;
  executionStatus: string;
  tag: string | null;
  parentWorkflowExecutionId: string | null;
  sourceStepsId: string | null;
  sourceStepName: string | null;
  createdAt: string;
  updatedAt: string;
}

// Pull request data from workflow execution
export interface PullRequestData {
  id: string;
  prId: number;
  prUrl: string;
  repoName: string;
  sourceBranchName: string;
  destinationBranchName: string;
  status: string;
  date: string;
  numberOfComments: number;
  repositoryUrl: string;
  updatedAt: string;
}

// Combined workflow data structure from API
export interface CombinedWorkflowData {
  workflows: Array<{
    workflowId: string;
    status: string;
    workflowName: string | null;
    workflowType: string;
    executionId: string;
    executionStatus: string;
    parentWorkflowExecutionId: string | null;
    sourceStepsId: string | null;
    tag?: string | null;
    createdAt?: string;
    updatedAt?: string;
    steps: WorkflowStep[];
    executionMetadata?: ExecutionMetadata[];
    // Workflow output (contains error info when failed)
    output?: { name?: string; message?: string; stack?: string } | null;
    // Git info for diff view (only available if baseCommitHash exists)
    gitInfo?: {
      hasGitInfo: boolean;
      branch?: string;
      repoUrl?: string;
      baseCommitHash?: string;
      commitHash?: string;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      pr_link?: string;
      preview?: {
        type: 'loadUrlWithUserAgent';
        userAgent: string;
        url: string;
      };
    };
    metadata?: {
      createdFrom?: string;
      originalRequest?: {
        title?: string;
        description?: string;
        workflowType?: string;
        executorType?: string;
        ticketId?: string;
        conversationId?: string;
        xyneId?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    } | null;
    executorType?: string;
    useQuestioningMode?: boolean;
    model?: string;
    createdBy?: string | null;
    // Pull requests created by this workflow execution
    pullRequests?: PullRequestData[];
  }>;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
  style?: React.CSSProperties;
  className?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  style?: React.CSSProperties;
  data?: WorkflowEdgeData;
  label?: string;
}

export interface WorkflowGraphNode {
  id: string;
  name: string;
  type: 'checkpoint' | 'agent' | 'conditional' | 'external' | 'loop';
  position?: { x: number; y: number };
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?:
    | 'default'
    | 'conditional-true'
    | 'conditional-false'
    | 'loop'
    | 'parallel-child'
    | 'loop-entry'
    | 'loop-back'
    | 'parallel'
    | 'parallel-join';
}

export interface WorkflowGraph {
  workflowType: string;
  name: string;
  description: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowStep {
  id: string;
  stepName: string | null;
  stepExecutorType: string;
  type: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  data: WorkflowStepData;
  workflowExecutionId?: string;
  expandedSteps?: WorkflowStep[];
  expandedExecutions?: Array<{
    executionId: string;
    status: string;
    steps: WorkflowStep[];
    isFromAgentExecution: boolean;
    parentStepName: string;
  }>;
  expandedWorkflows?: Array<{
    executionId: string;
    status: string;
    steps: WorkflowStep[];
    isFromAgentExecution: boolean;
    parentStepName: string;
  }>;
  // Parallel execution metadata
  parallelGroupId?: string;
  parallelChildIndex?: number;
  parallelParentStepName?: string;
  isParallelChild?: boolean;
  isParallelParent?: boolean;
  parallelChildrenCount?: number;
  // Backend-computed fields
  astNodeId?: string;
  computedStatus?: string;
  duration?: string; // Duration calculated by backend
}

export interface WorkflowStepsResponse {
  steps: WorkflowStep[];
}

export interface CombinedStepsWorkflow {
  workflowId: string;
  status: string;
  workflowName: string | null;
  workflowType: string;
  executionId: string;
  executionStatus: string;
  parentWorkflowExecutionId: string | null;
  sourceStepsId: string | null;
  steps: WorkflowStep[];
}

export interface CombinedStepsResponse {
  workflows: CombinedStepsWorkflow[];
}

// API Error types
export interface WorkflowApiError {
  error: string;
  message?: string;
  code?: string;
}

// Workflow execution control APIs
export interface WorkflowExecutionControlResponse {
  success: boolean;
  message: string;
  execution: {
    id: string;
    workflowId: string;
    status: string;
    parentWorkflowExecutionId: string | null;
    sourceStepsId: string | null;
    updatedAt: string;
  };
}

export interface WorkflowExecutionControlError {
  success: false;
  error: string;
}

// Workflow restore API
export interface RestoreWorkflowResponse {
  rerunExecutionId: string;
  actualRestoreStepId: string;
  actualRestoreStepName: string;
  liftedToParallel: boolean;
  liftChain: string[];
  sourceRootExecutionId: string;
  message: string;
}

// Rerun workflow from start response interface
export interface RerunFromStartResponse {
  rerunExecutionId: string;
  sourceExecutionId: string;
  message: string;
}

// Continue agentic step response interface
export interface ContinueAgenticStepResponse {
  rerunExecutionId: string;
  sourceExecutionId: string;
  message: string;
}

// Step details response interface (fixing unknown return type)
export interface StepDetailsResponse {
  stepName: string | null;
  input: {
    type: string;
    context: Record<string, unknown>;
    data: WorkflowStepData | null;
  } | null;
  output: {
    completed: boolean;
    result: unknown;
    completedAt: string;
    data: WorkflowStepData | null;
    expandedExecutions: Array<{
      executionId: string;
      status: string;
      steps: WorkflowStep[];
      isFromAgentExecution: boolean;
      parentStepName: string;
    }>;
    status: string | null;
  } | null;
  workflowExecution: {
    id: string;
    status: string;
    workflowId: string;
  };
  originalStep: WorkflowStep;
}

// Workflow refinement API types
export interface RefineWorkflowRequest {
  instructions: string;
  agentName?: string;
  systemPrompt?: string;
}

export interface RefineWorkflowResponse {
  success: boolean;
  message: string;
  executionId: string;
  stepId: string;
  status: string;
  gitInfo?: {
    branch: string;
    repoUrl?: string;
    commitHash?: string;
    workingDirectory?: string;
    pullRequestUrl?: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    pr_link?: string;
    hasCommits?: boolean;
  };
}

export interface RefineWorkflowError {
  success: false;
  error: string;
  details?: string;
  executionId: string;
  status: string;
}

export interface RefinementHistory {
  executionId: string;
  refinementCount: number;
  refinements: Array<{
    stepId: string;
    stepName: string | null;
    createdAt: string;
    status: string | null;
  }>;
}
