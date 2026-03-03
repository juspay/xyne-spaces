// Workflow type enums and related types for type-safe workflow management

export enum WorkflowType {
  USER_ONBOARDING = 'USER_ONBOARDING',
  BUG_WORKFLOW = 'BUG_WORKFLOW',
  BUG_WORKFLOW_EVAL = 'BUG_WORKFLOW_EVAL',
  BUG_WORKFLOW_EVAL_INNER_STEPS = 'BUG_WORKFLOW_EVAL_INNER_STEPS',
  BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL = 'BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL',
  FEATURE_IMPLEMENTATION = 'FEATURE_IMPLEMENTATION',
  FEATURE_PLANNING = 'FEATURE_PLANNING',
  XYNE_SPACES_FEATURE_IMPLEMENTATION = 'XYNE_SPACES_FEATURE_IMPLEMENTATION',
  FIDO_SERVER_WORKFLOW = 'FIDO_SERVER_WORKFLOW',
  CONNECTOR_MIGRATION = 'CONNECTOR_MIGRATION',
  CODER_WORKFLOW = 'CODER_WORKFLOW',
  QUERY_WORKFLOW = 'QUERY_WORKFLOW',
  INVESTIGATION_WORKFLOW = 'INVESTIGATION_WORKFLOW',
  GENIUS_INVESTIGATION_WORKFLOW = 'GENIUS_INVESTIGATION_WORKFLOW',
  STAGE_APPROVAL_WORKFLOW = 'STAGE_APPROVAL_WORKFLOW',
  GENIUS_QUERY_WORKFLOW = 'GENIUS_QUERY_WORKFLOW',
  NETWORK_DOCUMENT_PROCESSING = 'NETWORK_DOCUMENT_PROCESSING',
  INTEGRITY_DEBUG_WORKFLOW = 'INTEGRITY_DEBUG_WORKFLOW',
}

export enum WorkflowExecutionStatus {
  NEW = 'NEW',
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  CANCELLED = 'CANCELLED',
  WAIT_FOR_EVENT = 'WAIT_FOR_EVENT',
  PAUSED = 'PAUSED',
  WAITING_FOR_CHILD_EXECUTIONS = "WAITING_FOR_CHILD_EXECUTIONS",
  EXTERNAL_WAIT = "EXTERNAL_WAIT"
}

export enum WorkflowStatus {
  NEW = 'NEW',
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  PAUSED = 'PAUSED',
}

export enum WorkflowStepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  WAITING = 'waiting' // For external steps
}

// Workflow priority levels
export enum WorkflowPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

// Context types for workflows
export interface BaseWorkflowContext {
  ticketId: string
  userId?: string
  metadata?: Record<string, any>
  modelName?: string
}

export interface ImageAttachment {
  id: string
  type: 'image'
  data: string  // Base64 encoded image data
  mimeType: string
  name: string
}

export interface UserOnboardingContext extends BaseWorkflowContext {
  email: string
  userType: 'basic' | 'premium' | 'enterprise'
  invitedBy?: string
  preferences?: {
    notifications: boolean
    newsletter: boolean
  }
}

export interface BugWorkflowContext extends BaseWorkflowContext {
  [key: string]: any
  bugId: string
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  reportedBy: string
  merchantId?: string  // Merchant ID for genius investigation workflow (optional, required only for Investigation Workflow)
  assignedTo?: string
  labels?: string[]
  codeFiles?: string[]
  humanReadableId?: string
  imageAttachments?: ImageAttachment[]
}

export interface BugWorkflowEvalContext extends BugWorkflowContext {
  pr_url?: string;
  commits?: {
    "euler-api-txns"?: string;
    "euler-api-customer"?: string;
    "euler-api-order"?: string;
    "euler-api-gateway"?: string;
    "euler-api-cards"?: string;
    "euler-api-pre-txn"?: string;
    "euler-api-token"?: string;
    "euler-api-dashboard"?: string;
    "offer-engine"?: string;
  };
}

export interface BugWorkflowEvalOutput {
  run1?: any;
  run2?: any;
  run3?: any;
  run4?: any;
  run5?: any;
}

export interface FeatureImplementationContext extends BaseWorkflowContext {
  title: string
  description: string
  requirements: string
  repoUrl?: string
}

export interface FeaturePlanningContext extends BaseWorkflowContext {
  title: string
  description: string
  requirements: string
  contextAnalysis: string
  repoUrl?: string
  repoBranch?: string
  planningType?: string
}

export interface FidoServerWorkflowContext extends BaseWorkflowContext {
  projectName?: string
  repositoryUrl?: string
  workspaceDirectory?: string
  maxIterations?: number
  model?: string
  currentPrompt?: string
  originalPrompt?: string
  currentIteration?: number
  promptFilePath?: string
  workingDirectory?: string
  gitWorkflow?: {
    repositoryUrl: string
    workspaceDirectory: string
    cloneDirectory: string
    branchName: string
    clonedAt: string
    cloneOutput?: string
    branchOutput?: string
  }
  codingResults?: Record<string, {
    success: boolean
    output: string
    error: string
    executedAt: string
    promptUsed: string
  }>
  buildResults?: Record<string, {
    success: boolean
    output: string
    error: string
    executedAt: string
    command: string
  }>
  testResults?: Record<string, {
    success: boolean
    output: string
    error: string
    executedAt: string
    command: string
  }>
  promptRefactorHistory?: Record<string, {
    originalPrompt: string
    refactoredPrompt: string
    errorSummary: string
    refactorOutput: string
    refactoredAt: string
    error?: string
  }>
  savedPrompts?: Record<string, {
    fileName: string
    filePath: string
    promptLength: number
    savedAt: string
    error?: string
  }>
  iterationCommits?: Record<string, {
    success: boolean
    hasChanges: boolean
    message: string
    commitHash: string
    addOutput?: string
    commitOutput?: string
    committedAt: string
    error?: string
  }>
  iterationSummary?: Record<string, {
    codingSuccess: boolean
    buildSuccess: boolean
    testSuccess: boolean
    promptSaved: boolean
    commitSuccess: boolean
    overallSuccess: boolean
    completedAt: string
  }>
  gitOperations?: {
    success: boolean
    output: string
    error: string
    branchName: string
    executedAt: string
  }
  workflowSummary?: {
    completed: boolean
    totalIterations: number
    successfulCommits: number
    savedPrompts: number
    completedAt: string
    note: string
  }
  finalStatus?: {
    workflowCompleted: boolean
    overallSuccess: boolean
    totalIterations: number
    successfulIterations: number
    completedAt: string
    summary: {
      projectName?: string
      promptFile?: string
      workingDirectory?: string
      repositoryUrl?: string
      finalPrompt?: string
    }
  }
}


export interface ConnectorMigrationContext extends BaseWorkflowContext {
  [key: string]: any
  connectorName: string
  upiFlowsOnly?: boolean
  maxIterations?: number
  continuousImprovement?: boolean
  success_replay_id?: string
  jenkinsConfig?: {
    url: string
    path: string
    user: string
    token: string
  }
  // Runtime state (populated during execution)
  workingDirectory?: string
  featureBranchName?: string
  repositoryPaths?: {
    ucsPath: string
    eulerPath: string
    outputDir: string
  }
  repositorySetup?: {
    ucsResult: {
      success: boolean
      path: string
      error: string
    }
    eulerResult: {
      success: boolean
      path: string
      error: string
    }
    bothSuccessful: boolean
    setupAt: string
    generalError?: string
  }
  generatedPrompts?: {
    connectorName: string
    ucsPrompt: string
    eulerPrompt: string
    ucsPromptFile?: string
    eulerPromptFile?: string
    scriptOutput?: string
    timestamp: string
    error?: string
  }
  executablePrompts?: {
    ucsPrompt: string
    eulerPrompt: string
    preparedAt: string
    sourceType?: string
    error?: string
  }
  codegenPhase?: {
    promptsGenerated: boolean
    scriptExecuted: boolean
    codeGenerated: boolean
    promptsFileRead?: boolean
    agenticPromptsReady?: boolean
    filesVerified?: number
    xynePromptsExecuted?: boolean
    usingEnhancedInstructions?: boolean
  }
  xynePromptExecution?: {
    ucsResult: {
      success: boolean
      output: string
      error: string
      workingDirectory?: string  // Directory where agentic framework made changes
    }
    eulerResult: {
      success: boolean
      output: string
      error: string
      workingDirectory?: string  // Directory where agentic framework made changes
    }
    bothSuccessful: boolean
    executedAt: string
    generalError?: string
  }
  buildPhase?: {
    cargoResult?: {
      success: boolean
      output: string
      error: string
      executedAt: string
      fixApplied?: boolean
      originalError?: string
      fixOutput?: string
    }
    nixCabalResult?: {
      success: boolean
      output: string
      error: string
      executedAt: string
      fixApplied?: boolean
      originalError?: string
      fixOutput?: string
    }
  }
  buildArtPhase?: {
    buildTriggered: boolean
    buildMonitored: boolean
    artifactsDownloaded: boolean
    buildSuccess: boolean
    cargoSuccess: boolean
    nixCabalSuccess: boolean
    buildDetails?: any
  }
  artEvaluationPhase?: {
    artReportFetched: boolean
    reportAnalyzed: boolean
    promptsEnhanced: boolean
  }
  gitOperations?: {
    ucsResult: {
      success: boolean
      output: string
      error: string
      commitId?: string
    }
    eulerResult: {
      success: boolean
      output: string
      error: string
      commitId?: string
    }
    bothSuccessful: boolean
    branchName: string
    executedAt: string
    generalError?: string
  }
  jenkinsExecution?: {
    triggered: boolean
    response: any
    buildParams: any
    url: string
    triggeredAt: string
    success: boolean
    error?: string
  }
  artProcessing?: {
    replayId: string
    scriptExecuted: boolean
    scriptOutput: string
    scriptError: string
    reportFilePath: string
    artReportData: any[] | null
    processedAt: string
    success: boolean
  }
  xyneEvaluation?: {
    scriptExecuted: boolean
    scriptOutput: string
    scriptError: string
    enhancedInstructions: string
    xyneResultFile: string
    artifactsDir: string
    evaluatedAt: string
    success: boolean
  }
  iterationCount?: number
  migrationContext?: any // Full migration context from TypeScript extraction
  l2Analysis?: {
    hasL2Changes: boolean
    modifiedL2Files: string[]
    analysisSkipped: boolean
    analysisResult: {
      agenticOutput: string
      agenticSuccess: boolean
      analyzedAt: string
      detectionMethod?: string
      fileBasedDetection?: boolean
      functionBasedDetection?: boolean
    } | null
    analyzedAt: string
    error?: string
  }
}

export interface CoderWorkflowContext extends BaseWorkflowContext {
  [key: string]: any
  // Required fields for non-admin users
  userPrompt: string  // Task prompt - what the user wants implemented
  product: string     // Product name - which product to work on

  // Auto-generated or optional fields
  coderId?: string
  title?: string
  description?: string
  selectedRepositories?: string[]  // Optional - if not provided, uses all product repos
  priority?: 'low' | 'medium' | 'high' | 'critical'
  assignedTo?: string
  labels?: string[]
  humanReadableId?: string
}

export interface StageApprovalContext extends BaseWorkflowContext {
  taskId: string
  taskTitle: string
  taskDescription: string
  assignedTo?: string
}

export interface NetworkDocumentContext extends BaseWorkflowContext {
  fileId: string
  fileName: string
  localPath: string
  network: string
  extractedText?: string
  documentType?: string
  keyFindings?: string[]
  actionItems?: string[]
  error?: string
  [key: string]: any
}

export interface IntegrityDebugContext extends BaseWorkflowContext {
  csvData: string // CSV content with headers: order_id,merchant_id,failure_reason,gateway,flow (deprecated)
  sessions: Array<{
    orderId: string
    merchantId: string
    failureReason: string
    gateway: string
    flow: 'WEBHOOK' | 'REDIRECTION' | 'SYNC'
  }>
  orderIds?: string[] // Array of all order IDs to analyze
}

// Union type for all workflow contexts
export type WorkflowContext = any

// Workflow execution result
export interface WorkflowExecutionResult {
  executionId: string
  workflowType: WorkflowType
  status: WorkflowExecutionStatus
  startedAt: Date
  completedAt?: Date
  duration?: number // in milliseconds
  stepCount: number
  completedSteps: number
  failedSteps: number
  error?: string
  result?: any
}

// Workflow execution progress
export interface WorkflowExecutionProgress {
  executionId: string
  workflowType: WorkflowType
  status: WorkflowExecutionStatus
  progress: number // percentage 0-100
  currentStep?: string
  completedSteps: string[]
  pendingSteps: string[]
  failedSteps: string[]
  estimatedCompletion?: Date
  lastUpdated: Date
}

// External step data payload
export interface ExternalStepData<R> {
  stepId: string
  data: R
  providedBy?: string
  providedAt: Date
  metadata?: Record<string, unknown>
}

// Workflow trigger request
export interface WorkflowTriggerRequest {
  ticketId: string
  workflowType: WorkflowType
  context: WorkflowContext
  priority?: WorkflowPriority
  scheduledAt?: Date
  metadata?: Record<string, any>
  createdBy?: string
}

// Type guards for workflow contexts
export function isUserOnboardingContext(context: WorkflowContext): context is UserOnboardingContext {
  return 'email' in context && 'userType' in context
}

export function isBugWorkflowContext(context: WorkflowContext): context is BugWorkflowContext {
  return 'bugId' in context && 'title' in context && 'severity' in context
}

export function isConnectorMigrationContext(context: WorkflowContext): context is ConnectorMigrationContext {
  return 'connectorName' in context
}

export function isCoderWorkflowContext(context: WorkflowContext): context is CoderWorkflowContext {
  return 'userPrompt' in context && 'product' in context
}

// Helper functions
export function getWorkflowTypeDisplayName(workflowType: WorkflowType): string {
  const displayNames: Record<WorkflowType, string> = {
    [WorkflowType.USER_ONBOARDING]: 'User Onboarding',
    [WorkflowType.BUG_WORKFLOW]: 'Bug Workflow',
    [WorkflowType.BUG_WORKFLOW_EVAL]: 'Bug Workflow-eval',
    [WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS]: 'BUG_WORKFLOW_EVAL_INNER_STEPS',
    [WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL]: 'Bug Workflow Eval Inner Steps (Experimental)',
    [WorkflowType.FEATURE_IMPLEMENTATION]: 'Feature Implementation',
    [WorkflowType.FEATURE_PLANNING]: 'Feature Planning',
    [WorkflowType.XYNE_SPACES_FEATURE_IMPLEMENTATION]: 'Xyne Spaces Feature Implementation',
    [WorkflowType.FIDO_SERVER_WORKFLOW]: 'FIDO Server Workflow',
    [WorkflowType.CONNECTOR_MIGRATION]: 'Connector Migration',
    [WorkflowType.CODER_WORKFLOW]: 'Coder Workflow',
    [WorkflowType.QUERY_WORKFLOW]: 'Query Workflow',
    [WorkflowType.INVESTIGATION_WORKFLOW]: 'Investigation Workflow',
    [WorkflowType.GENIUS_INVESTIGATION_WORKFLOW]: 'Genius Investigation Workflow',
    [WorkflowType.GENIUS_QUERY_WORKFLOW]: 'Genius Query Workflow',
    [WorkflowType.STAGE_APPROVAL_WORKFLOW]: 'Stage Approval Workflow',
    [WorkflowType.NETWORK_DOCUMENT_PROCESSING]: 'Network Document Processing',
    [WorkflowType.INTEGRITY_DEBUG_WORKFLOW]: 'Integrity Debug Workflow',
  };
  return displayNames[workflowType]
}

export function isTerminalStatus(status: WorkflowExecutionStatus): boolean {
  return [
    WorkflowExecutionStatus.SUCCESS,
    WorkflowExecutionStatus.FAILURE,
    WorkflowExecutionStatus.CANCELLED
  ].includes(status)
}

export function isActiveStatus(status: WorkflowExecutionStatus): boolean {
  return [
    WorkflowExecutionStatus.PENDING,
    WorkflowExecutionStatus.RUNNING,
    WorkflowExecutionStatus.WAIT_FOR_EVENT,
    WorkflowExecutionStatus.NEW,
    WorkflowExecutionStatus.WAITING_FOR_CHILD_EXECUTIONS,
    WorkflowExecutionStatus.EXTERNAL_WAIT
  ].includes(status)
}

export enum AI_STAGES {
  TO_DO = 'TO_DO',
  AI_PICKED_UP = 'AI_PICKED_UP',
  HUMAN_INTERVENTION = 'HUMAN_INTERVENTION'
}
