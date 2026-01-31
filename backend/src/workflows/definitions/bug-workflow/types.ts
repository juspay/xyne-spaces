import type { GitDiffFile, GitDiffStats } from '../../workflow-types';

export interface GraphInfo {
    graph_id: string;
    path: string;
    directed: boolean;
    nodes: number;
    edges: number;
    loaded_at: number;
}

export interface AddGraphPayload {
    graph_id: string;
    path: string;
}

export interface ChatSessionResponse {
  id: string;
  title: string;
  repository_id?: string;
  product_id?: string;
  repository_name: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  tool_calls_count: number;
}

export interface ToolCall {
  tool_name: string;
  tool_args: any;
  result: any;
}

export interface SessionDetailsResponse {
  session: ChatSessionResponse;
  messages: any[]; // Keeping messages flexible as we don't use them here
  tool_calls: {
    tool_name: string;
    args: any;
    results: any;
  }[];
}

export interface CrossVerifyReesposne {
  "status": string;
  "message": string;
  "missing_modules"?: string;
  "missing_functions"?: string;
}

export interface CodeFixResult {
    repository: string;
    success: boolean;
    branchName?: string;
    error?: string;
    executedAt: string;
    changeSummary?: string;
    latestCommit?: string;
    userDescription?: string;
    codeChangesSummary?: string;
    gitDiff?: GitDiffFile[];
    diffStats?: GitDiffStats;
}

export interface RepoInfo {
    repo_name: string;
    module_name: string;
    function_name: string;
    suggested_changes: string;
}

export type WorkflowRunResult = {
  runIndex?: number;
  results: CodeFixResult[];
  failureInfo?: {
    step: string;
    reason: string;
  };
};

export type BugWorkflowEvalOutput = {
  run1?: WorkflowRunResult;
  run2?: WorkflowRunResult;
  run3?: WorkflowRunResult;
  run4?: WorkflowRunResult;
  run5?: WorkflowRunResult;
  run6?: WorkflowRunResult;
  run7?: WorkflowRunResult;
  run8?: WorkflowRunResult;
  run9?: WorkflowRunResult;
  run10?: WorkflowRunResult;
}

export type problemStatement = {
  llm_understanding: string;
  expected_behavior: string;
  observed_behavior: string;
  steps_to_reproduce: string;
  validation_steps_after_fix: string;
}

export type rcaResult = {
  repo_name: string;
  function_name: string;
  module_name: string;
  code_snippet: string;
  reason: string;
  references: string[];
  mermaid_diagram: string;
}[]

export type multiRepoCoeResult = {
  repos: RepoInfo[];
}

export type groupedMultiRepoCoeResult = {
  [repo_name: string]: {
    module_name: string;
    function_name: string;
    suggested_changes: string;
  }[];
}

export type commits = {
  'euler-api-txns'?: string;
  'euler-api-customer'?: string;
  'euler-api-order'?: string;
  'euler-api-gateway'?: string;
  'euler-api-cards'?: string;
  'euler-api-pre-txn'?: string;
  'euler-api-token'?: string;
  'euler-api-dashboard'?: string;
  'offer-engine'?: string;
}

export const repoIdMap: { [key: string]: { repoId: string, projectId: string } } = {
    "euler-api-txns": { repoId: "1461", projectId: "JBIZ" },
    "euler-api-gateway": { repoId: "1405", projectId: "EXC" },
    "euler-api-order": { repoId: "1454", projectId: "JBIZ" },
    "euler-api-customer": { repoId: "1452", projectId: "JBIZ" },
    "euler-api-cards": { repoId: "1450", projectId: "JBIZ" },
    "euler-api-token": { repoId: "1459", projectId: "JBIZ" },
    "euler-api-pre-txn": { repoId: "1456", projectId: "JBIZ" },
    "euler-api-dashboard": { repoId: "1453", projectId: "JBIZ" },
    "offer-engine": { repoId: "1496", projectId: "JBIZ" },
};
