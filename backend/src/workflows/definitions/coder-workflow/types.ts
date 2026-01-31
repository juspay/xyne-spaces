// Coder Workflow specific types

export interface CoderCodeFixResult {
  repository: string
  success: boolean
  branchName?: string
  error?: string
  errorDetails?: any // Detailed error information for debugging
  executedAt: string
  changeSummary?: string
  latestCommit?: string
  userDescription?: string
  codeChangesSummary?: string
}

export interface CoderRepositorySetup {
  targetRepository: string
  repoUrl: string
  branch: string
  baseBranch: string
  localPath?: string // Path to cloned repository in unified workspace
}

export interface CoderWorkflowResult {
  results: CoderCodeFixResult[]
  prLinks?: { [repo: string]: string } // PR links for each repository
  failureInfo?: {
    step: string
    reason: string
    details?: any
  }
}

// Repository information for multi-repo changes
export interface CoderRepoInfo {
  repo_name: string
  suggested_changes: string
}

// For grouped repository changes
export type GroupedCoderRepoChanges = {
  [repo_name: string]: {
    suggested_changes: string
  }[]
}

// Product selection interface
export interface ProductSelection {
  productName: string
  selectedRepositories: string[]
}

// User prompt processing result
export interface ProcessedUserPrompt {
  originalPrompt: string
  processedPrompt: string
  repositories: string[]
  processedAt: string
}

// Repository validation result
export interface RepoValidationResult {
  validRepos: string[]
  invalidRepos: string[]
  availableRepos: string[]
  productRepos: string[]
}

// Workflow execution context
export interface CoderExecutionContext {
  coderId: string
  userPrompt: string
  product: string
  selectedRepositories: string[]
  processedPrompt?: ProcessedUserPrompt
  repoValidation?: RepoValidationResult
}

// Step-specific results
export interface ProductRepoMappingResult {
  product: string
  availableRepositories: string[]
  selectedRepositories: string[]
  validationResult: RepoValidationResult
}

export interface RepositorySetupResult {
  repositorySetups: CoderRepositorySetup[]
}

// Error types specific to coder workflow
export class CoderWorkflowError extends Error {
  constructor(
    message: string,
    public step: string,
    public details?: any
  ) {
    super(message)
    this.name = 'CoderWorkflowError'
  }
}

export class ProductValidationError extends CoderWorkflowError {
  constructor(productName: string, availableProducts: string[]) {
    super(
      `Invalid product '${productName}'. Available products: ${availableProducts.join(', ')}`,
      'PRODUCT_VALIDATION',
      { productName, availableProducts }
    )
    this.name = 'ProductValidationError'
  }
}

export class RepositoryValidationError extends CoderWorkflowError {
  constructor(invalidRepos: string[], validRepos: string[]) {
    super(
      `Invalid repositories: ${invalidRepos.join(', ')}. Valid repositories: ${validRepos.join(', ')}`,
      'REPOSITORY_VALIDATION',
      { invalidRepos, validRepos }
    )
    this.name = 'RepositoryValidationError'
  }
}

export class CodeGenerationError extends CoderWorkflowError {
  constructor(repository: string, error: string) {
    super(
      `Code generation failed for repository '${repository}': ${error}`,
      'CODE_GENERATION',
      { repository, error }
    )
    this.name = 'CodeGenerationError'
  }
}

// Repository clone information (reused from bug workflow)
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
}