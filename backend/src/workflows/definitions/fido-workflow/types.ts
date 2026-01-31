
// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

import { BaseWorkflowContext, WorkflowCustomConfig, GitInfo } from '../../workflow-types'

export interface FidoServerWorkflowContext extends BaseWorkflowContext {
  ticketId: string
  projectName?: string
  repositoryUrl: string
  workspaceDirectory: string
  maxIterations?: number
  repoBranch?: string
  custom?: WorkflowCustomConfig
  fidoValidationType?: string
}

export interface FidoServerWorkflowOutput {
  ticketId: string
  status: 'completed' | 'failed'
  implementationDetails: {
    filesChanged: string[]
    commitHash?: string
    branch: string
    buildPassed: boolean
    conformancePassed: boolean
    iterationsCompleted: number
    conformanceResults?: {
      totalTests: number
      passedTests: number
      failedTests: number
      errorTests: number
      failedTestCases: string[]
    }
  }
  summary: string
  gitInfo: GitInfo
}

export interface BuildResult {
  success: boolean
  output: string
  error: string
  executedAt: string
}

export interface RunResult {
  success: boolean;
  output: string;
  error: string;
  executedAt: string;
  timedOut?: boolean;
}

export interface TestResult {
  success: boolean
  output: string
  error: string
  testsRun: number
  testsPassed: number
  testsFailed: number
  coverage?: number
  executedAt: string
}

export interface ConformanceResult {
  success: boolean
  output: string
  executedAt: string
  outputLength?: number
  testResults?: {
    passed: number
    failed: number
    total: number
  }
}

export interface HealthCheckResult {
  check: string;
  success: boolean;
  details: string;
  remediation?: string;
}

export interface CodeReviewResult {
  success: boolean
  output: string
  executedAt: string
  reviewScore: number // 0-100 score
  issues: {
    critical: string[]
    major: string[]
    minor: string[]
    suggestions: string[]
  }
  productionReadiness: {
    isProductionReady: boolean
    hardcodedValues: string[]
    todoComments: string[]
    unimplementedFeatures: string[]
    securityIssues: string[]
    databaseImplementation: {
      isComplete: boolean
      issues: string[]
    }
  }
}

// =============================================================================
// DISTRIBUTED EXECUTION TYPES
// =============================================================================

export interface ServerRunResult {
  success: boolean
  serverStarted: boolean
  serverReady: boolean
  port: number
  startupTime: number
  output: string
  error: string
  crashDetails?: string
  healthCheckPassed: boolean
  executedAt: string
}

export interface RemoteConfig {
  host: string
  user: string
  sshKeyPath?: string
  repoPath: string
  clientScript: string
  fidoToolPath: string
}

export interface RemoteExecutionRequest {
  repoUrl: string
  branch: string
  executionId: string
  serverCallbackUrl?: string
}

export interface RemoteExecutionResult {
  executionId: string
  success: boolean
  buildResult: BuildResult
  serverRunResult: ServerRunResult
  conformanceResult: ConformanceResult | null
  errorDetails?: string
  executedAt: string
}

// Update FidoServerWorkflowContext to include remote config
export interface DistributedFidoServerWorkflowContext extends FidoServerWorkflowContext {
  remoteClientConfig?: RemoteConfig
  useRemoteExecution?: boolean
}
