import { NodeAction, WorkflowStatus } from '../constants';
import { TagColor } from '@juspay/blend-design-system';

/**
 * Git information extracted from workflow output data
 */
export interface GitDiffFile {
  oldPath: string;
  newPath: string;
  type: 'add' | 'delete' | 'modify' | 'rename';
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
  }>;
}

export interface GitDiffStats {
  additions: number;
  deletions: number;
  files: number;
}

export interface GitInfo {
  branch: string;
  repoUrl: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  pr_link: string | null;
  baseCommitHash?: string;
  commitHash?: string;
  gitDiff?: GitDiffFile[];
  diffStats?: GitDiffStats;
  [key: string]: unknown;
}

/**
 * Type guard to check if a value is a valid object
 */
export const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object';

/**
 * Type guard to check if an object contains valid GitInfo
 */
export const isGitInfo = (v: unknown): v is GitInfo => {
  if (!isObject(v)) return false;
  const branch = v['branch'];
  const repoUrl = v['repoUrl'];
  return typeof branch === 'string' && typeof repoUrl === 'string';
};

/**
 * Extract git information from workflow output data
 * Returns null if the data doesn't contain valid git info
 */
export const extractGitInfo = (
  outputData: unknown,
  // eslint-disable-next-line @typescript-eslint/naming-convention
): { branch: string; repoUrl: string; pr_link: string | null } | null => {
  if (!isGitInfo(outputData)) return null;

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { branch, repoUrl, pr_link } = outputData;
  return {
    branch,
    repoUrl,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    pr_link: typeof pr_link === 'string' ? pr_link : null,
  };
};

/**
 * Convert SSH/Git repository URL to HTTPS URL for Bitbucket
 * Handles various URL formats and returns a browsable HTTP URL
 */
export const convertRepoToHttp = (repoUrl: string): string => {
  try {
    // SSH example: ssh://git@github.com/example-org/]+)\.git$/);

    if (match) {
      const project = match[1];
      const repo = match[2];
      return `https://bitbucket.example.com/projects/${project}/repos/${repo}`;
    }

    // fallback for HTTPS clones
    return repoUrl
      .replace(/^ssh:\/\/git@/, 'https://')
      .replace('ssh.bitbucket.juspay.net', 'bitbucket.juspay.net')
      .replace(/\.git$/, '');
  } catch {
    return repoUrl;
  }
};

/**
 * Build a branch URL for Bitbucket from repo URL and branch name
 */
export const buildBranchUrl = (repoUrl: string, branch: string): string => {
  const httpRepo = convertRepoToHttp(repoUrl);
  return `${httpRepo}/commits?until=refs/heads/${encodeURIComponent(branch)}`;
};

/**
 * Options for formatting step data
 */
export interface DataFormatOptions {
  emptyMessage?: string;
  indent?: number;
  maxLength?: number;
  prettify?: boolean;
}

/**
 * Format step data for display in input/output tabs
 * Extracted from StepDetails.tsx formatData function with enhancements
 */
export const formatStepData = (data: unknown, options?: DataFormatOptions): string => {
  const {
    emptyMessage = 'No data available',
    indent = 2,
    maxLength,
    prettify = true,
  } = options || {};

  if (data === null || data === undefined) {
    return emptyMessage;
  }

  if (typeof data === 'string') {
    if (data.trim() === '') return emptyMessage;
    return maxLength && data.length > maxLength ? data.substring(0, maxLength) + '...' : data;
  }

  try {
    let formatted: string;

    if (prettify) {
      formatted = JSON.stringify(data, null, indent);
    } else {
      formatted = JSON.stringify(data);
    }

    if (maxLength && formatted.length > maxLength) {
      return formatted.substring(0, maxLength) + '...';
    }

    return formatted;
  } catch {
    /* Ignore JSON stringify errors */
    return 'Unable to format data';
  }
};

/**
 * Node action availability mapping based on status
 * Extracted from TaskNode.tsx availableActions logic
 */
const NODE_ACTION_MAP: Record<WorkflowStatus, NodeAction[]> = {
  running: ['pause', 'stop'],
  paused: ['resume', 'stop', 'restart'],
  completed: ['restart'],
  failed: ['restart', 'stop'],
  pending: ['restart', 'stop'],
  // eslint-disable-next-line @typescript-eslint/naming-convention
  not_executed: ['restart'],
  waiting: [], // Special case handled separately
  skipped: ['restart'],
  success: ['restart'],
  failure: ['restart', 'stop'],
};

/**
 * Get available actions for a workflow step based on its status and type
 * Extracted from TaskNode.tsx availableActions computation
 */
export const getAvailableNodeActions = (
  status: WorkflowStatus,
  externalStepType?: string,
): NodeAction[] => {
  const normalizedStatus = status.toLowerCase() as WorkflowStatus;

  // Special case: user approval steps show approve action
  if (normalizedStatus === 'waiting' && externalStepType === 'user_approval') {
    return ['approve'];
  }

  // Return mapped actions or default fallback
  return NODE_ACTION_MAP[normalizedStatus] || ['restart'];
};

/**
 * Status color configuration for StepDetails component
 */
export interface StatusColorConfig {
  bg: string;
  text: string;
  border: string;
}

export const STATUS_COLOR_MAP: Record<string, StatusColorConfig> = {
  completed: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
  success: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' },
  failure: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' },
  running: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200' },
  paused: { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-200' },
  skipped: { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-200' },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  not_executed: { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-200' },
  waiting: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
};

/**
 * Get Tailwind CSS classes for status badges/tags in StepDetails
 * Extracted from StepDetails.tsx getStatusColor function
 */
export const getStatusColorClasses = (status?: string): string => {
  const normalizedStatus = status?.toLowerCase() || 'pending';
  const config = STATUS_COLOR_MAP[normalizedStatus] || STATUS_COLOR_MAP['pending']!;
  return `${config.bg} ${config.text} ${config.border}`;
};

/**
 * Status tag configuration for TaskNode component
 */
export interface StatusTagConfig {
  icon: string;
  text: string;
  color: TagColor;
}

export const STATUS_TAG_MAP: Record<string, StatusTagConfig> = {
  running: { icon: 'running', text: 'Running', color: TagColor.SUCCESS },
  completed: { icon: 'check-circle', text: 'Success', color: TagColor.SUCCESS },
  failed: { icon: 'failed', text: 'Failed', color: TagColor.ERROR },
  skipped: { icon: 'skipped', text: 'Skipped', color: TagColor.NEUTRAL },
  paused: { icon: 'pause', text: 'Paused', color: TagColor.PURPLE },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  not_executed: { icon: 'not_executed', text: 'Not Executed', color: TagColor.NEUTRAL },
  waiting: { icon: 'pending', text: 'Waiting for Approval', color: TagColor.NEUTRAL },
  pending: { icon: 'pending', text: 'Pending', color: TagColor.NEUTRAL },
  success: { icon: 'check-circle', text: 'Success', color: TagColor.SUCCESS },
};

/**
 * Get status tag configuration for TaskNode component
 * Extracted from TaskNode.tsx statusMap
 */
export const getStatusTagConfig = (status?: string): StatusTagConfig => {
  return STATUS_TAG_MAP[status || 'pending'] || STATUS_TAG_MAP['pending']!;
};

/**
 * Node border class configuration for TaskNode styling
 */
export const NODE_BORDER_MAP: Record<string, string> = {
  running: 'border-amber-400 from-white to-amber-50',
  completed: 'border-emerald-500 from-white to-emerald-50',
  failed: 'border-red-500 from-white to-red-50',
  skipped: 'border-gray-300 from-white to-gray-50 opacity-80',
  paused: 'border-violet-500 from-white to-violet-50',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  not_executed: 'border-gray-400 from-white to-gray-50 opacity-70',
  waiting: 'border-blue-500 from-white to-blue-50',
  pending: 'border-gray-200 from-white to-gray-50',
};

/**
 * Get border classes for TaskNode based on status and type
 * Extracted from TaskNode.tsx borderClass mapping
 */
export const getNodeBorderClasses = (status?: string, nodeType?: string): string => {
  let classes = NODE_BORDER_MAP[status || 'pending'] || NODE_BORDER_MAP['pending']!;

  // Add special styling for start/end nodes
  if (nodeType === 'start') classes += ' border-emerald-500';
  if (nodeType === 'end') classes += ' border-gray-500';

  return classes;
};

/**
 * Execution metadata from workflow execution
 */
export interface WorkflowExecutionMetadata {
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
}

/**
 * Calculate display execution time for workflow
 * Returns execution time in seconds as string, or undefined if not computable
 */
export const calculateExecutionTime = (
  metadataExecutionTime: string | undefined,
  latestExecution: WorkflowExecutionMetadata | undefined,
  displayStatus: string,
): string | undefined => {
  if (metadataExecutionTime) return metadataExecutionTime;
  if (
    latestExecution?.createdAt &&
    latestExecution?.updatedAt &&
    ['SUCCESS', 'FAILED'].includes(displayStatus)
  ) {
    const start = new Date(latestExecution.createdAt).getTime();
    const end = new Date(latestExecution.updatedAt).getTime();
    return Math.floor((end - start) / 1000).toString();
  }

  return undefined;
};
