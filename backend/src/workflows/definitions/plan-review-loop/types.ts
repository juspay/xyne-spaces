/**
 * Types for Xyne Spaces Plan Review Loop Workflow
 */

import { BaseWorkflowContext, GitInfo } from '../../workflow-types';
import { ImageAttachment } from '../../types/workflow-enums';
import { ExecutorType } from '../../workflow-types';
import { ReviewMetrics } from './utils';

export interface XyneSpacesPlanReviewLoopContext extends BaseWorkflowContext {
  title: string;
  description: string;
  baseBranch?: string;
  repoBranch?: string;
  checkoutCommit?: string;
  imageAttachments?: ImageAttachment[];
  taskType?: 'feature' | 'bug' | 'refactor' | 'performance' | 'security' | 'documentation';
  maxLoopIterations?: number;
  approvalThreshold?: number;
}

export interface XyneSpacesPlanReviewLoopOutput {
  ticketId: string;
  status: 'completed' | 'failed';
  planPath?: string;
  implementationDetails: {
    filesChanged: string[];
    commitHash?: string;
    branch: string;
    verificationPassed: boolean;
    iterationsCompleted: number;
  };
  reviewMetrics: ReviewMetrics;
  summary: string;
  gitInfo: GitInfo;
  failureReason?: string;
}

export interface WorkflowContext {
  ticketId: string;
  title: string;
  description: string;
  imageAttachments?: ImageAttachment[];
  repoBranch?: string;
  baseBranch: string;
  checkoutCommit?: string;
  executorType?: ExecutorType;
  useQuestioningMode: boolean;
  taskType: 'feature' | 'bug' | 'refactor' | 'performance' | 'security' | 'documentation';
  maxIterations: number;
  approvalThreshold: number;
}

export interface ExecutionState {
  gitInfo: GitInfo & { repoUrl: string };
  baseCommitHash?: string;
  workflowBranch?: string;
  approvedPlan?: string;
  planPath?: string;
  changedFiles: string[];
  coAuthor?: { name: string; email: string };
}

export interface PhaseResult<T = void> {
  success: boolean;
  data?: T;
  failureReason?: string;
}