// Workflow type enums and related types for type-safe workflow management

export enum WorkflowType {
  USER_ONBOARDING = 'USER_ONBOARDING',
  QUERY_WORKFLOW = 'QUERY_WORKFLOW',
  STAGE_APPROVAL_WORKFLOW = 'STAGE_APPROVAL_WORKFLOW',
  GENIUS_QUERY_WORKFLOW = 'GENIUS_QUERY_WORKFLOW',
  NETWORK_DOCUMENT_PROCESSING = 'NETWORK_DOCUMENT_PROCESSING',
  IT_SUPPORT_WORKFLOW = 'IT_SUPPORT_WORKFLOW',
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
  additionalUserInfo?: string // Optional free-text passed by the caller; appended to Step 4 (Log Collection) user prompt
}

export interface SpecsVerificationWorkFlowContext extends BaseWorkflowContext {
  gateway: string
  maxIterations: number
}

export interface IssueWorkflowContext extends BaseWorkflowContext {
  description: string
  raiseQuestions?: boolean
  solution?: string
  clarificationAnswers?: string
  debugAndFixDirectly?: boolean
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

export function isCoderWorkflowContext(context: WorkflowContext): context is CoderWorkflowContext {
  return 'userPrompt' in context && 'product' in context
}

export function isIssueWorkflowContext(context: WorkflowContext): context is IssueWorkflowContext {
  return 'description' in context
}

// Helper functions
export function getWorkflowTypeDisplayName(workflowType: WorkflowType): string {
  const displayNames: Record<WorkflowType, string> = {
    [WorkflowType.USER_ONBOARDING]: 'User Onboarding',
    [WorkflowType.QUERY_WORKFLOW]: 'Query Workflow',
    [WorkflowType.GENIUS_QUERY_WORKFLOW]: 'Genius Query Workflow',
    [WorkflowType.STAGE_APPROVAL_WORKFLOW]: 'Stage Approval Workflow',
    [WorkflowType.NETWORK_DOCUMENT_PROCESSING]: 'Network Document Processing',
    [WorkflowType.IT_SUPPORT_WORKFLOW]: 'IT Support Workflow',
  };
  // Fallback to the raw value: historical DB rows may carry types that have
  // since been removed from the enum (e.g. XYNE_AUTO_RCA_WORKFLOW).
  return displayNames[workflowType] ?? workflowType
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
