// Coder Workflow utility functions

import { CoderWorkflowContext } from '../../types/workflow-enums'
import {
  REPO_METADATA,
  getRepositoriesForProduct,
  getAvailableProducts,
  validateProduct,
  getRepoMetadata
} from './productRepoMapping'
import {
  CoderRepositorySetup,
  CoderCodeFixResult
} from './types'
import {logger} from '@/utils/logger';

/**
 * Generate PR link for a repository
 */
export const generatePrLink = (repoName: string, branch: string, baseBranch: string): string | undefined => {
  const repoMetadata = getRepoMetadata(repoName)
  if (!repoMetadata) {
    logger.warn(`⚠️ [PR-LINK] No metadata found for repository: ${repoName}`)
    return undefined
  }

  const { projectId } = repoMetadata
  const prLink = `https://bitbucket.example.com/projects/${projectId}/repos/${repoName}/compare/commits?sourceBranch=${branch}&targetBranch=${baseBranch}`
  
  logger.info(`🔗 [PR-LINK] Generated PR link for ${repoName}: ${prLink}`)
  return prLink
}

/**
 * Validates if the user has admin permissions (placeholder for future implementation)
 */
export function isAdminUser(_userId?: string): boolean {
  // TODO: Implement actual admin check logic
  // For now, return true for development
  return true
}

/**
 * Gets the formatted list of available products for user selection
 */
export function getFormattedProductList(): { name: string; repositories: string[]; repositoryCount: number }[] {
  const products = getAvailableProducts()

  return products.map(product => ({
    name: product,
    repositories: getRepositoriesForProduct(product),
    repositoryCount: getRepositoriesForProduct(product).length
  }))
}

/**
 * Validates the coder workflow context
 */
export function validateCoderContext(context: CoderWorkflowContext): {
  isValid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // Note: coderId and title are now optional and auto-generated if not provided

  if (!context.userPrompt || context.userPrompt.trim() === '') {
    errors.push('User prompt is required and cannot be empty')
  }

  if (!context.product) {
    errors.push('Product selection is required')
  } else if (!validateProduct(context.product)) {
    errors.push(`Invalid product '${context.product}'. Available products: ${getAvailableProducts().join(', ')}`)
  }

  // Repository validation
  if (context.selectedRepositories && context.selectedRepositories.length > 0) {
    const productRepos = getRepositoriesForProduct(context.product)
    const invalidRepos = context.selectedRepositories.filter(repo => !productRepos.includes(repo))

    if (invalidRepos.length > 0) {
      warnings.push(`Some selected repositories don't belong to product '${context.product}': ${invalidRepos.join(', ')}`)
    }
  }

  // Prompt length validation
  if (context.userPrompt && context.userPrompt.length > 10000) {
    warnings.push('User prompt is very long (>10000 characters). Consider breaking it down for better results.')
  }

  if (context.userPrompt && context.userPrompt.length < 10) {
    warnings.push('User prompt is very short. Consider providing more detailed requirements.')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Generates a summary of the coder workflow execution
 */
export function generateWorkflowSummary(
  context: CoderWorkflowContext,
  results: CoderCodeFixResult[]
): {
  summary: string
  successCount: number
  failureCount: number
  totalRepositories: number
  executionTime?: string
} {
  const successfulResults = results.filter(r => r.success)
  const failedResults = results.filter(r => !r.success)

  const summary = `
Coder Workflow Execution Summary
================================

Request Details:
- Coder ID: ${context.coderId}
- Title: ${context.title}
- Product: ${context.product}
- User Prompt: ${context.userPrompt.substring(0, 100)}${context.userPrompt.length > 100 ? '...' : ''}

Execution Results:
- Total Repositories: ${results.length}
- Successful: ${successfulResults.length}
- Failed: ${failedResults.length}

${successfulResults.length > 0 ? `
Successful Repositories:
${successfulResults.map(r => `  ✅ ${r.repository} (Branch: ${r.branchName}, Commit: ${r.latestCommit?.substring(0, 8)})`).join('\n')}
` : ''}

${failedResults.length > 0 ? `
Failed Repositories:
${failedResults.map(r => `  ❌ ${r.repository} - ${r.error}`).join('\n')}
` : ''}
`.trim()

  return {
    summary,
    successCount: successfulResults.length,
    failureCount: failedResults.length,
    totalRepositories: results.length
  }
}

/**
 * Helper function to create a formatted prompt for repository-specific changes
 */
export function createRepositorySpecificPrompt(
  basePrompt: string,
  repository: string,
  repositoryContext?: string
): string {
  return `${basePrompt}

# Repository-Specific Context for ${repository}
${repositoryContext || 'No additional context provided for this repository.'}

# Important Notes
- Focus on changes specific to the ${repository} repository
- Ensure changes are compatible with the existing codebase structure
- Follow the established patterns and conventions in this repository
- Consider dependencies and interactions with other repositories in the product`
}

/**
 * Extracts repository names from user prompt using simple keyword matching
 */
export function extractRepositoryHints(userPrompt: string): string[] {
  const prompt = userPrompt.toLowerCase()
  const availableRepos = Object.keys(REPO_METADATA)

  return availableRepos.filter(repo => {
    const repoName = repo.toLowerCase()
    // Check for exact matches or partial matches
    return prompt.includes(repoName) ||
           prompt.includes(repoName.replace('euler-api-', '')) ||
           prompt.includes(repoName.replace('-', ' '))
  })
}

/**
 * Generates branch naming suggestions based on the user prompt
 */
export function generateBranchNameSuggestion(
  coderId: string,
  userPrompt: string,
  repository: string
): string {
  // Extract key words from the prompt for branch naming
  const words = userPrompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && word.length < 15)
    .slice(0, 3) // Take first 3 meaningful words
    .join('-')

  const truncatedWords = words.length > 30 ? words.substring(0, 30) : words

  return `CODER-0000-${truncatedWords || 'feature'}-${coderId}-${repository}-${Date.now()}`
}

/**
 * Validates repository setup configuration
 */
export function validateRepositorySetup(setups: CoderRepositorySetup[]): {
  isValid: boolean
  errors: string[]
  validSetups: CoderRepositorySetup[]
} {
  const errors: string[] = []
  const validSetups: CoderRepositorySetup[] = []

  for (const setup of setups) {
    let isValidSetup = true

    if (!setup.targetRepository) {
      errors.push('Target repository is required')
      isValidSetup = false
    }

    if (!setup.repoUrl) {
      errors.push(`Repository URL is required for ${setup.targetRepository}`)
      isValidSetup = false
    }

    if (!setup.branch) {
      errors.push(`Branch name is required for ${setup.targetRepository}`)
      isValidSetup = false
    }

    if (!setup.baseBranch) {
      errors.push(`Base branch is required for ${setup.targetRepository}`)
      isValidSetup = false
    }

    if (isValidSetup) {
      validSetups.push(setup)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    validSetups
  }
}

/**
 * Creates a formatted error message for workflow failures
 */
export function createWorkflowErrorMessage(
  step: string,
  error: string,
  context: CoderWorkflowContext
): string {
  return `
Coder Workflow Failed
====================

Failed Step: ${step}
Error: ${error}

Context:
- Coder ID: ${context.coderId}
- Product: ${context.product}
- Title: ${context.title}

Please review the error and try again. If the issue persists, contact support.
`.trim()
}

/**
 * Gets statistics about product-repository mappings
 */
export function getProductStatistics(): {
  totalProducts: number
  totalRepositories: number
  averageReposPerProduct: number
  productDetails: { name: string; repoCount: number }[]
} {
  const products = getAvailableProducts()
  const allRepos = new Set<string>()

  const productDetails = products.map(product => {
    const repos = getRepositoriesForProduct(product)
    repos.forEach(repo => allRepos.add(repo))

    return {
      name: product,
      repoCount: repos.length
    }
  })

  return {
    totalProducts: products.length,
    totalRepositories: allRepos.size,
    averageReposPerProduct: Math.round((Array.from(allRepos).length / products.length) * 100) / 100,
    productDetails
  }
}
