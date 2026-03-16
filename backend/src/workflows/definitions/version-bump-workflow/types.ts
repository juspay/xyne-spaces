import { BaseWorkflowContext } from '../../workflow-types';

export const VersionBumpStepsEnumBase = {
  CREATE_JIRA_TICKET: 'create_jira_ticket',
  CLONE_AND_CHECKOUT: 'clone_and_checkout',
  CREATE_BRANCH: 'create_branch',
  UPDATE_FLAKE_NIX: 'update_flake_nix',
  UPDATE_FLAKE_LOCK: 'update_flake_lock',
  COMMIT_AND_PUSH: 'commit_and_push',
  RAISE_PR: 'raise_pr',
  PARALLEL_BUMP: 'parallel_bump',
} as const;

/**
 * Base type for VersionBumpStepsEnum keys.
 */
export type VersionBumpStepsKeys = keyof typeof VersionBumpStepsEnumBase;

/**
 * Type for the steps object. 
 * We use string values instead of strict literals to allow for dynamic prefixing.
 */
export type VersionBumpStepsEnumType = {
  [K in VersionBumpStepsKeys]: string;
};

/**
 * Returns the VersionBumpStepsEnumBase object, optionally with repository name prefixing.
 * Usage: VersionBumpStepsEnum(repoName).CREATE_JIRA_TICKET
 */
export const VersionBumpStepsEnum = (repoName?: string): VersionBumpStepsEnumType => {
  if (!repoName) {
    return VersionBumpStepsEnumBase as unknown as VersionBumpStepsEnumType;
  }

  const scopedSteps: Partial<VersionBumpStepsEnumType> = {};
  for (const key of Object.keys(VersionBumpStepsEnumBase) as VersionBumpStepsKeys[]) {
    scopedSteps[key] = `${repoName}.${VersionBumpStepsEnumBase[key]}`;
  }
  return scopedSteps as VersionBumpStepsEnumType;
};

export interface VersionBumpWorkflowInput extends BaseWorkflowContext {
  repositoryNames: string[];
  dependencyName: string;
  version: string;
  email: string;
}

export interface VersionBumpWorkflowContext extends VersionBumpWorkflowInput {}

export interface VersionBumpResult {
  success: boolean;
  repositoryUrl: string;
  branchName?: string;
  jiraTicket?: string;
  prUrl?: string;
  error?: string;
}

export interface VersionBumpWorkflowOutput {
  status: 'completed' | 'partial_failure' | 'failed';
  results: VersionBumpResult[];
  summary: string;
}

export interface JiraTicketResult {
  success: boolean;
  ticketId: string;
  error?: string;
}
