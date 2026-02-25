// =============================================================================
// ENUMS
// =============================================================================
export enum FidoWorkType {
  DEEP = 'DEEP',
  FAST = 'FAST',
}
// =============================================================================
// TYPE DEFINITIONS
// =============================================================================
import { BaseWorkflowContext,WorkflowCustomConfig, GitInfo } from '../../workflow-types';
export interface FidoServerWorkflowContext extends BaseWorkflowContext {
  ticketId: string;
  repositoryUrl: string;
  maxIterations?: number;
  repoBranch?: string;
  baseBranch?: string;
  description?: string;
  buildCommand?: string;
  testDetails?: TestDetail[];
  ispoller?: boolean;
  type?: FidoWorkType;
  connectorName?: string;
  connectorBaseUrl?: string;
  custom?: WorkflowCustomConfig
}
export interface TestDetail {
  filename: string;
  command: string;
  parameters: (string | Record<string, unknown>)[];
}
export interface BoilerCodeResult {
  success: boolean;
  output: string;
  error: string;
  branchName: string;
  executedAt: string;
}
export interface fidoServerWorkflowOutput {
  ticketId: string;
  status: 'completed' | 'failed';
  implementationDetails: {
    filesChanged: string[];
    commitHash?: string;
    branch: string;
    buildPassed: boolean;
    conformancePassed: boolean;
    iterationsCompleted: number;
  };
  summary: string;
  gitInfo: GitInfo;
}
export interface BuildResult {
  success: boolean;
  output: string;
  error: string;
  workingDirectory: string;
  executedAt: string;
}
export interface RunResult {
  success: boolean;
  output: string;
  error: string;
  executedAt: string;
  timedOut?: boolean;
}
export interface TestResult {
  success: boolean;
  output: string;
  error: string;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  coverage?: number;
  executedAt: string;
}
export interface ConformanceResult {
  success: boolean;
  output: string;
}
export interface HealthCheckResult {
  check: string;
  success: boolean;
  details: string;
  remediation?: string;
}
export interface CodeReviewResult {
  success: boolean;
  output: string;
  executedAt: string;
  reviewScore: number; // 0-100 score
  issues: {
    critical: string[];
    major: string[];
    minor: string[];
    suggestions: string[];
  };
  productionReadiness: {
    isProductionReady: boolean;
    hardcodedValues: string[];
    todoComments: string[];
    unimplementedFeatures: string[];
    securityIssues: string[];
    databaseImplementation: {
      isComplete: boolean;
      issues: string[];
    };
  };
}
// =============================================================================
// DISTRIBUTED EXECUTION TYPES
// =============================================================================
export interface ServerRunResult {
  success: boolean;
  serverStarted: boolean;
  serverReady: boolean;
  port: number;
  startupTime: number;
  output: string;
  error: string;
  crashDetails?: string;
  healthCheckPassed: boolean;
  executedAt: string;
}
export interface RemoteConfig {
  host: string;
  user: string;
  sshKeyPath?: string;
  repoPath: string;
  clientScript: string;
  fidoToolPath: string;
}
export interface RemoteExecutionRequest {
  repoUrl: string;
  branch: string;
  executionId: string;
  serverCallbackUrl?: string;
}
export interface RemoteExecutionResult {
  executionId: string;
  success: boolean;
  buildResult: BuildResult;
  serverRunResult: ServerRunResult;
  conformanceResult: ConformanceResult | null;
  errorDetails?: string;
  executedAt: string;
}
// Update FidoServerWorkflowContext to include remote config
export interface DistributedFidoServerWorkflowContext extends FidoServerWorkflowContext {
  remoteClientConfig?: RemoteConfig;
  useRemoteExecution?: boolean;
}