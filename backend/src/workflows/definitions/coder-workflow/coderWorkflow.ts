
// Coder Workflow definition

import { WorkflowEngine, LoopControl, AgenticCheckpointConfig } from '../../workflow-types'
import { WorkflowDefinition } from '../../registry/workflowRegistry'
import { WorkflowType, CoderWorkflowContext } from '../../types/workflow-enums'
import { config } from '../../../config/env'
import type { ConversationResult } from '@framework'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { mkdtemp, rm, writeFile, unlink, access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CoderCodeFixResult,
  CoderRepositorySetup,
  CoderWorkflowResult,
  ProductRepoMappingResult,
  RepositorySetupResult,
  ProductValidationError,
  RepositoryValidationError,
  CodeGenerationError
} from './types'
import {
  getRepositoriesForProduct,
  getAvailableProducts,
  validateProduct,
  validateRepositories,
  getRepoMetadata
} from './productRepoMapping'
import { generatePrLink } from './utils'
import {logger} from '@/utils/logger';

// Step IDs for coder workflow
export enum CoderWorkflowSteps {
  VALIDATE_PRODUCT_AND_REPOS = 'validate_product_and_repos',
  PROCESS_USER_PROMPT = 'process_user_prompt',
  REPOSITORY_SETUP = 'repository_setup',
  CODE_FIX_REPOSITORIES = 'code_fix_repositories',
  CODE_FIX_LOOP = 'code_fix_loop',
  MAKING_AGENTIC_CODE_CHANGES = 'making_agentic_code_changes',
  VERIFY_BUILD = 'verify_build',
  GENERATE_SUMMARY = 'generate_summary'
}

/**
 * Validates the selected product and repositories
 */
const validateProductAndRepos = async (
  product: string,
  selectedRepositories: string[] = []
): Promise<ProductRepoMappingResult> => {
  try {
    logger.info(`📋 [CODER_WORKFLOW] Validating product: ${product}`)

    // Validate product exists
    if (!validateProduct(product)) {
      const availableProducts = getAvailableProducts()
      throw new ProductValidationError(product, availableProducts)
    }

    // Get available repositories for the product
    const productRepositories = getRepositoriesForProduct(product)
    logger.info(`📦 [CODER_WORKFLOW] Product '${product}' has ${productRepositories.length} repositories`)

    if (productRepositories.length === 0) {
      throw new Error(`Product '${product}' has no repositories configured`)
    }

    // If no repositories are specifically selected, use all product repositories
    const repositoriesToUse = selectedRepositories.length > 0 ? selectedRepositories : productRepositories

    // Validate that selected repositories are valid
    const validationResult = validateRepositories(repositoriesToUse)

    if (validationResult.invalid.length > 0) {
      logger.warn(`⚠️ [CODER_WORKFLOW] Invalid repositories found: ${validationResult.invalid.join(', ')}`)
      // For coder workflow, we'll filter out invalid repos and continue with valid ones
      // throw new RepositoryValidationError(validationResult.invalid, validationResult.valid)
    }

    // Ensure selected repositories belong to the product
    const reposNotInProduct = validationResult.valid.filter(repo => !productRepositories.includes(repo))
    if (reposNotInProduct.length > 0) {
      logger.warn(`⚠️ [CODER_WORKFLOW] Repositories not in product '${product}': ${reposNotInProduct.join(', ')}`)
      // Filter out repositories that don't belong to the product
      validationResult.valid = validationResult.valid.filter(repo => productRepositories.includes(repo))
    }

    if (validationResult.valid.length === 0) {
      throw new RepositoryValidationError(repositoriesToUse, productRepositories)
    }

    logger.info(`✅ [CODER_WORKFLOW] Using ${validationResult.valid.length} repositories: ${validationResult.valid.join(', ')}`)

    return {
      product,
      availableRepositories: productRepositories,
      selectedRepositories: validationResult.valid,
      validationResult: {
        validRepos: validationResult.valid,
        invalidRepos: validationResult.invalid,
        availableRepos: productRepositories,
        productRepos: productRepositories
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('❌ [PRODUCT_VALIDATION] Product and repository validation failed:', errorMessage)
    // Re-throw with context
    if (error instanceof ProductValidationError || error instanceof RepositoryValidationError) {
      throw error
    }
    throw new Error(`Product validation failed: ${errorMessage}`)
  }
}

/**
 * Processes the user prompt and prepares it for code generation
 */
const processUserPrompt = async (
  coderId: string,
  userPrompt: string,
  selectedRepositories: string[]
) => {
  try {
    logger.info(`🔤 [CODER_WORKFLOW] Processing user prompt for coder: ${coderId}`)

    // Validate inputs
    if (!userPrompt || userPrompt.trim().length === 0) {
      throw new Error('User prompt cannot be empty')
    }

    if (!selectedRepositories || selectedRepositories.length === 0) {
      throw new Error('No repositories selected for prompt processing')
    }

    // For now, we'll use the prompt as-is. In future, this could include:
    // - Prompt enhancement
    // - Context injection
    // - Repository-specific customization

    const processedPrompt = `${userPrompt}

# Repository Context
You will be working with the following repositories:
${selectedRepositories.map(repo => `- ${repo}`).join('\n')}

# Instructions
Please implement the requested changes following best practices:
1. Ensure code is production-ready
2. Follow existing coding standards in each repository
3. Add appropriate error handling
4. Include necessary tests if applicable
5. Update documentation if needed

Make sure to understand the existing codebase structure before making changes.`

    logger.info(`✅ [CODER_WORKFLOW] User prompt processed successfully`)

    return {
      originalPrompt: userPrompt,
      processedPrompt,
      repositories: selectedRepositories,
      processedAt: new Date().toISOString()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('❌ [PROMPT_PROCESSING] User prompt processing failed:', errorMessage)
    throw new Error(`Prompt processing failed: ${errorMessage}`)
  }
}

/**
 * Sets up unified workspace with all repositories cloned
 */
const setupUnifiedWorkspace = async (
  coderId: string,
  selectedRepositories: string[]
): Promise<RepositorySetupResult & { workspacePath?: string }> => {
  logger.info(`📦 [CODER_WORKFLOW] Setting up unified workspace for coder: ${coderId}`)

  try {
    if (selectedRepositories.length === 0) {
      throw new Error("No repositories selected for setup.")
    }

    // Create unified workspace directory
    const workspacePath = await mkdtemp(join(tmpdir(), `coder-workspace-${coderId}-`))
    logger.info(`📁 [CODER_WORKFLOW] Created unified workspace: ${workspacePath}`)

    const repositorySetups: CoderRepositorySetup[] = []

    // Clone all repositories into the workspace
    for (const repoName of selectedRepositories) {
      const repoMetadata = getRepoMetadata(repoName)

      if (!repoMetadata) {
        logger.warn(`⚠️ [CODER_WORKFLOW] No metadata found for repository: ${repoName}`)
        continue
      }

      const repoPath = join(workspacePath, repoName)
      const jiraId = 'CODER-0000'
      const branchName = `feature/devqa-xyne-${jiraId}-feature-${coderId}-${repoName}-${randomUUID()}`

      logger.info(`📥 [CODER_WORKFLOW] Cloning ${repoName} from ${repoMetadata.cloneUrl}...`)

      // Clone repository
      await new Promise<void>((resolve, reject) => {
        const cloneProcess = spawn('git', ['clone', repoMetadata.cloneUrl, repoPath], {
          stdio: ['inherit', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''

        cloneProcess.stdout?.on('data', (data) => {
          const output = data.toString().trim()
          stdout += output + '\n'
          logger.info(`[GIT CLONE ${repoName}] ${output}`)
        })

        cloneProcess.stderr?.on('data', (data) => {
          const output = data.toString().trim()
          stderr += output + '\n'
          logger.info(`[GIT CLONE ${repoName}] ${output}`)
        })

        cloneProcess.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            // Provide detailed error message
            let errorMsg = `Failed to clone repository '${repoName}' (exit code ${code})`

            if (stderr.includes('Repository not found')) {
              errorMsg += '. Repository does not exist or you do not have access permissions'
            } else if (stderr.includes('Authentication failed')) {
              errorMsg += '. Authentication failed - check your credentials'
            } else if (stderr.includes('Could not resolve host')) {
              errorMsg += '. Network error - could not resolve host'
            } else if (stderr) {
              errorMsg += `. Error: ${stderr.split('\n').slice(-3).join(' ')}`
            }

            reject(new Error(errorMsg))
          }
        })
      })

      // Create feature branch
      await new Promise<void>((resolve, reject) => {
        const branchProcess = spawn('git', ['checkout', '-b', branchName], {
          cwd: repoPath,
          stdio: ['inherit', 'pipe', 'pipe']
        })

        let stderr = ''

        branchProcess.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        branchProcess.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            const errorMsg = `Failed to create branch '${branchName}' in repository '${repoName}' (exit code ${code})${stderr ? `: ${stderr}` : ''}`
            reject(new Error(errorMsg))
          }
        })
      })

      repositorySetups.push({
        targetRepository: repoName,
        repoUrl: repoMetadata.cloneUrl,
        branch: branchName,
        baseBranch: repoMetadata.baseBranch,
        localPath: repoPath
      })

      logger.info(`✅ [CODER_WORKFLOW] Set up repository: ${repoName} -> ${branchName}`)
    }

    logger.info(`✅ [CODER_WORKFLOW] Unified workspace setup completed for ${repositorySetups.length} repositories`)
    return {
      repositorySetups,
      workspacePath
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('❌ [REPOSITORY_SETUP] Unified workspace setup failed:', errorMessage)
    // Throw descriptive error to properly mark step as failed in UI
    throw new Error(`Repository setup failed: ${errorMessage}`)
  }
}

/**
 * Detects which repositories have changes by checking git status
 */
const detectRepositoryChanges = async (
  repositorySetups: CoderRepositorySetup[]
): Promise<string[]> => {
  logger.info(`🔍 [CODER_WORKFLOW] Detecting repositories with changes...`)

  const changedRepositories: string[] = []

  for (const repoSetup of repositorySetups) {
    if (!repoSetup.localPath) continue

    try {
      // Check git status to see if there are any changes
      const hasChanges = await new Promise<boolean>((resolve) => {
        const statusProcess = spawn('git', ['status', '--porcelain'], {
          cwd: repoSetup.localPath,
          stdio: ['inherit', 'pipe', 'pipe']
        })

        let output = ''
        statusProcess.stdout?.on('data', (data) => {
          output += data.toString()
        })

        statusProcess.on('close', () => {
          // If output is not empty, there are changes
          const hasUnstagedChanges = output.trim().length > 0
          resolve(hasUnstagedChanges)
        })
      })

      if (hasChanges) {
        changedRepositories.push(repoSetup.targetRepository)
        logger.info(`📝 [CODER_WORKFLOW] Changes detected in: ${repoSetup.targetRepository}`)
      } else {
        logger.info(`✨ [CODER_WORKFLOW] No changes in: ${repoSetup.targetRepository}`)
      }
    } catch (error) {
      logger.warn(`⚠️ [CODER_WORKFLOW] Failed to check changes in ${repoSetup.targetRepository}:`, error)
    }
  }

  logger.info(`🎯 [CODER_WORKFLOW] Found changes in ${changedRepositories.length}/${repositorySetups.length} repositories`)
  return changedRepositories
}

/**
 * Commits and pushes changes for modified repositories
 */
const commitAndPushChanges = async (
  repositorySetups: CoderRepositorySetup[],
  changedRepositories: string[],
  commitMessage: string
): Promise<{ [repo: string]: string }> => {
  logger.info(`📤 [CODER_WORKFLOW] Committing and pushing changes for ${changedRepositories.length} repositories...`)

  const commitHashes: { [repo: string]: string } = {}

  for (const repoName of changedRepositories) {
    const repoSetup = repositorySetups.find(r => r.targetRepository === repoName)
    if (!repoSetup?.localPath) continue

    try {
      // Stage all changes
      await new Promise<void>((resolve, reject) => {
        const addProcess = spawn('git', ['add', '.'], {
          cwd: repoSetup.localPath,
          stdio: ['inherit', 'pipe', 'pipe']
        })

        let stderr = ''
        addProcess.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        addProcess.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error(`Failed to stage changes in '${repoName}' (exit code ${code})${stderr ? `: ${stderr}` : ''}`))
          }
        })
      })

      // Commit changes
      await new Promise<void>((resolve, reject) => {
        const commitProcess = spawn('git', ['commit', '-m', commitMessage], {
          cwd: repoSetup.localPath,
          stdio: ['inherit', 'pipe', 'pipe']
        })

        let stderr = ''
        commitProcess.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        commitProcess.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error(`Failed to commit changes in '${repoName}' (exit code ${code})${stderr ? `: ${stderr}` : ''}`))
          }
        })
      })

      // Get commit hash
      const commitHash = await new Promise<string>((resolve) => {
        const hashProcess = spawn('git', ['rev-parse', 'HEAD'], {
          cwd: repoSetup.localPath,
          stdio: ['inherit', 'pipe', 'pipe']
        })

        let hash = ''
        hashProcess.stdout?.on('data', (data) => {
          hash += data.toString().trim()
        })

        hashProcess.on('close', () => {
          resolve(hash)
        })
      })

      // Push to remote
      await new Promise<void>((resolve, reject) => {
        const pushProcess = spawn('git', ['push', 'origin', repoSetup.branch], {
          cwd: repoSetup.localPath,
          stdio: ['inherit', 'pipe', 'pipe']
        })

        let stderr = ''
        let stdout = ''

        pushProcess.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        pushProcess.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        pushProcess.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            // Provide detailed error message based on the failure type
            let errorMsg = `Failed to push changes to '${repoName}' (exit code ${code})`

            if (stderr.includes('Authentication failed') || stderr.includes('Permission denied')) {
              errorMsg += '. Authentication failed - check your SSH keys or access tokens'
            } else if (stderr.includes('protected branch')) {
              errorMsg += '. The branch is protected and requires specific permissions'
            } else if (stderr.includes('non-fast-forward')) {
              errorMsg += '. Push rejected - remote has newer commits'
            } else if (stderr.includes('could not read Username')) {
              errorMsg += '. Git credentials not configured'
            } else if (stderr) {
              // Include last few lines of stderr for context
              const errorLines = stderr.trim().split('\n').slice(-2).join(' ')
              errorMsg += `. Error: ${errorLines}`
            }

            logger.error(`❌ [GIT_PUSH] ${errorMsg}`)
            reject(new Error(errorMsg))
          }
        })
      })

      commitHashes[repoName] = commitHash
      logger.info(`✅ [CODER_WORKFLOW] Successfully committed and pushed ${repoName}: ${commitHash}`)

    } catch (error) {
      logger.error(`❌ [CODER_WORKFLOW] Failed to commit/push ${repoName}:`, error)
      // Re-throw the error so the caller knows the operation failed
      throw error
    }
  }

  return commitHashes
}

/**
 * Builds only the repositories that have changes
 */
const buildModifiedRepositories = async (
  repositorySetups: CoderRepositorySetup[],
  changedRepositories: string[]
): Promise<{ [repo: string]: { success: boolean; error?: string } }> => {
  logger.info(`🔨 [CODER_WORKFLOW] Building ${changedRepositories.length} modified repositories...`)

  const buildResults: { [repo: string]: { success: boolean; error?: string } } = {}

  for (const repoName of changedRepositories) {
    const repoSetup = repositorySetups.find(r => r.targetRepository === repoName)
    if (!repoSetup?.localPath) continue

    logger.info(`🔨 [BUILD-CHECK] Building ${repoName}...`)

    try {
      const buildResult = await verifyRepositoryBuildInWorkspace(repoSetup.localPath, repoName)
      buildResults[repoName] = {
        success: buildResult.success,
        error: buildResult.error
      }

      if (buildResult.success) {
        logger.info(`✅ [BUILD-CHECK] Build successful for ${repoName}`)
      } else {
        logger.error(`❌ [BUILD-CHECK] Build failed for ${repoName}: ${buildResult.error}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      buildResults[repoName] = {
        success: false,
        error: errorMessage
      }
      logger.error(`❌ [BUILD-CHECK] Build failed for ${repoName}:`, errorMessage)
    }
  }

  return buildResults
}

/**
 * Detect project type based on directory structure
 */
async function detectProjectType(repoPath: string): Promise<'npm' | 'cabal'> {
  try {
    // Check if backend/package.json exists (npm project like xyne-spaces)
    await access(join(repoPath, 'backend', 'package.json'))
    return 'npm'
  } catch {
    // If no backend/package.json, assume it's a cabal project (Express Checkout)
    return 'cabal'
  }
}

/**
 * Build npm project (xyne-spaces)
 */
async function buildNpmProject(
  repoPath: string,
  repositoryName: string
): Promise<{ success: boolean; error?: string; output?: string }> {
  logger.info(`📦 [BUILD-NPM] Building npm project: ${repositoryName}`)

  let buildOutput = ''
  let buildErrors = ''

  try {
    // Build framework first (backend depends on it)
    logger.info(`🔨 [BUILD-NPM] Building framework for ${repositoryName}...`)
    await new Promise<void>((resolve, reject) => {
      const frameworkBuildProcess = spawn('bash', ['-c', 'cd framework && npm cache clean --force && npm install --force && npm run build'], {
        cwd: repoPath,
        stdio: ['inherit', 'pipe', 'pipe']
      })

      frameworkBuildProcess.stdout?.on('data', (data) => {
        const output = data.toString()
        buildOutput += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD-FRAMEWORK ${repositoryName}] ${line}`)
        })
      })

      frameworkBuildProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        buildErrors += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD-FRAMEWORK ${repositoryName}] ${line}`)
        })
      })

      frameworkBuildProcess.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Framework build failed with exit code ${code}\n${buildErrors}`))
        }
      })

      // Set timeout (10 minutes for npm install + build)
      setTimeout(() => {
        frameworkBuildProcess.kill()
        reject(new Error('Framework build timeout after 10 minutes'))
      }, 600000)
    })

    logger.info(`✅ [BUILD-NPM] Framework build successful for ${repositoryName}`)

    // Build backend
    logger.info(`🔨 [BUILD-NPM] Building backend for ${repositoryName}...`)
    await new Promise<void>((resolve, reject) => {
      const backendBuildProcess = spawn('bash', ['-c', 'cd backend && npm cache clean --force && npm install --force && npm run build'], {
        cwd: repoPath,
        stdio: ['inherit', 'pipe', 'pipe']
      })

      backendBuildProcess.stdout?.on('data', (data) => {
        const output = data.toString()
        buildOutput += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD-BACKEND ${repositoryName}] ${line}`)
        })
      })

      backendBuildProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        buildErrors += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD-BACKEND ${repositoryName}] ${line}`)
        })
      })

      backendBuildProcess.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Backend build failed with exit code ${code}\n${buildErrors}`))
        }
      })

      // Set timeout (10 minutes for npm install + build)
      setTimeout(() => {
        backendBuildProcess.kill()
        reject(new Error('Backend build timeout after 10 minutes'))
      }, 600000)
    })

    logger.info(`✅ [BUILD-NPM] Backend build successful for ${repositoryName}`)

    // Build dashboard
    logger.info(`🔨 [BUILD-NPM] Building dashboard for ${repositoryName}...`)
    await new Promise<void>((resolve, reject) => {
      const dashboardBuildProcess = spawn('bash', ['-c', 'cd dashboard && npm cache clean --force && npm install --force && npm run build'], {
        cwd: repoPath,
        stdio: ['inherit', 'pipe', 'pipe']
      })

      dashboardBuildProcess.stdout?.on('data', (data) => {
        const output = data.toString()
        buildOutput += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD-DASHBOARD ${repositoryName}] ${line}`)
        })
      })

      dashboardBuildProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        buildErrors += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD-DASHBOARD ${repositoryName}] ${line}`)
        })
      })

      dashboardBuildProcess.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Dashboard build failed with exit code ${code}\n${buildErrors}`))
        }
      })

      // Set timeout (10 minutes for npm install + build)
      setTimeout(() => {
        dashboardBuildProcess.kill()
        reject(new Error('Dashboard build timeout after 10 minutes'))
      }, 600000)
    })

    logger.info(`✅ [BUILD-NPM] Dashboard build successful for ${repositoryName}`)
    logger.info(`✅ [BUILD-NPM] All builds successful for ${repositoryName}!`)

    return {
      success: true,
      output: 'Framework, backend, and dashboard builds completed successfully'
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`❌ [BUILD-NPM] Build failed for ${repositoryName}:`, errorMessage)
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Build cabal project (Express Checkout repos)
 */
async function buildCabalProject(
  repoPath: string,
  repositoryName: string
): Promise<{ success: boolean; error?: string; output?: string }> {
  logger.info(`📦 [BUILD-CABAL] Building cabal project: ${repositoryName}`)

  let buildOutput = ''
  let buildErrors = ''

  try {
    await new Promise<void>((resolve, reject) => {
      const buildProcess = spawn('nix', ['develop', '--command', 'bash', '-c', 'cabal update && cabal build -v0 --ghc-options="-w"'], {
        cwd: repoPath,
        stdio: ['inherit', 'pipe', 'pipe']
      })

      buildProcess.stdout?.on('data', (data) => {
        const output = data.toString()
        buildOutput += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD ${repositoryName}] ${line}`)
        })
      })

      buildProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        buildErrors += output
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) logger.info(`[BUILD ${repositoryName}] ${line}`)
        })
      })

      buildProcess.on('close', async (code) => {
        if (code === 0) {
          if (buildErrors.includes('ld: warning:')) {
            logger.info(`[BUILD ${repositoryName}] Build completed with warnings (safe to ignore)`)
          }
          resolve()
        } else {
          try {
            const tempErrorFile = join(repoPath, 'build_errors.txt')
            await writeFile(tempErrorFile, buildErrors + '\n' + buildOutput)

            const errorExtractionResult = await new Promise<string>((sedResolve) => {
              const sedProcess = spawn('bash', ['-c', `sed -n '15,$p' "${tempErrorFile}" | sed -n '/error:/,/^$/p'`], {
                cwd: repoPath,
                stdio: ['inherit', 'pipe', 'pipe']
              })

              let filteredErrors = ''
              sedProcess.stdout?.on('data', (data) => {
                filteredErrors += data.toString()
              })

              sedProcess.on('close', () => {
                sedResolve(filteredErrors.trim() || buildErrors)
              })
            })

            await unlink(tempErrorFile)
            const errorDetails = errorExtractionResult || `Build failed with exit code ${code}`
            reject(new Error(errorDetails))

          } catch (filterError) {
            logger.warn(`⚠️ [BUILD-VERIFY] Error filtering failed for ${repositoryName}, using full output`)
            const errorDetails = buildErrors || buildOutput || `Build failed with exit code ${code}`
            reject(new Error(errorDetails))
          }
        }
      })

      setTimeout(() => {
        buildProcess.kill()
        reject(new Error('Build timeout after 30 minutes'))
      }, 1800000)
    })

    logger.info(`✅ [BUILD-CABAL] Build successful for ${repositoryName}!`)
    return {
      success: true,
      output: 'Build completed successfully'
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`❌ [BUILD-CABAL] Build failed for ${repositoryName}:`, errorMessage)
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Verify build in workspace directory (no cloning needed)
 * Supports both npm (xyne-spaces) and cabal (Express Checkout) projects
 */
async function verifyRepositoryBuildInWorkspace(
  repoPath: string,
  repositoryName: string
): Promise<{ success: boolean; error?: string; output?: string }> {
  // Check if mock build is enabled
  if (config.use_mock_build) {
    logger.info(`🎭 [BUILD-MOCK] Mock build enabled - skipping actual build for ${repositoryName}`)
    await new Promise(resolve => setTimeout(resolve, 2000)) // Simulate build time
    logger.info(`✅ [BUILD-MOCK] Mock build successful for ${repositoryName}`)
    return {
      success: true,
      output: `Mock build completed successfully for ${repositoryName}`
    }
  }

  try {
    logger.info(`🔨 [BUILD-VERIFY] Running build for ${repositoryName}...`)

    // Detect project type
    const projectType = await detectProjectType(repoPath)
    logger.info(`🔍 [BUILD-VERIFY] Detected project type: ${projectType} for ${repositoryName}`)

    // Build based on project type
    if (projectType === 'npm') {
      return await buildNpmProject(repoPath, repositoryName)
    } else {
      return await buildCabalProject(repoPath, repositoryName)
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`❌ [BUILD-VERIFY] Build failed for ${repositoryName}:`, errorMessage)
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Cleans up text by removing newline characters and extra whitespace
 */
const cleanTextForDisplay = (text: string | undefined): string | undefined => {
  if (!text) return text

  // Replace all newline characters with spaces
  // Then replace multiple spaces with a single space
  // Then trim the result
  return text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Formats the workflow summary for display in UI
 */
const formatWorkflowSummary = async (
  codeFixesResults: CoderCodeFixResult[],
  repositorySetups: CoderRepositorySetup[]
): Promise<{
  results: Array<{
    repository: string
    success: boolean
    branchName?: string
    executedAt: string
    codeChangesSummary?: string
  }>
  prLinks: { [repo: string]: string }
}> => {
  const successfulFixes = codeFixesResults.filter(fix => fix.success && fix.latestCommit)
  const prLinks: { [repo: string]: string } = {}

  // Generate PR links for all repositories with results
  for (const fix of codeFixesResults) {
    if (fix.branchName) {
      const repoSetup = repositorySetups.find(r => r.targetRepository === fix.repository)
      if (repoSetup && repoSetup.branch && repoSetup.baseBranch) {
        const prLink = generatePrLink(fix.repository, repoSetup.branch, repoSetup.baseBranch)
        if (prLink) {
          prLinks[fix.repository] = prLink
          logger.info(`🔗 [PR-LINK] Generated PR link for ${fix.repository}: ${prLink}`)
        }
      }
    }
  }

  // Build summary for display - removing userDescription, latestCommit, and newlines
  const cleanedResults = codeFixesResults.map(fix => ({
    repository: fix.repository,
    success: fix.success,
    branchName: fix.branchName,
    executedAt: fix.executedAt,
    codeChangesSummary: cleanTextForDisplay(fix.codeChangesSummary) // Remove newlines and extra whitespace
  }))

  // Build summary - this will be displayed in the UI
  logger.info(`📊 [CODER-DEBUG] Product workflow completed. Results:`)
  logger.info(JSON.stringify(cleanedResults, null, 2))
  logger.info(`\n✅ Successfully completed ${successfulFixes.length}/${codeFixesResults.length} repositories`)

  // Display PR links
  if (Object.keys(prLinks).length > 0) {
    logger.info(`\n## PR Links:`)
    for (const [repo, link] of Object.entries(prLinks)) {
      logger.info(`🔗 [PR-LINK] ${repo}: ${link}`)
    }
  }

  return {
    results: cleanedResults,
    prLinks
  }
}

/**
 * Formats the failure summary for display in UI
 */
const formatFailureSummary = async (
  step: string,
  reason: string
): Promise<{
  results: Array<{
    repository: string
    success: boolean
    branchName?: string
    executedAt: string
    codeChangesSummary?: string
  }>
  prLinks: { [repo: string]: string }
}> => {
  // Log to console for UI display
  logger.info(`❌ [WORKFLOW-FAILED] Coder workflow failed`)
  logger.info(``)
  logger.info(`**Failed Step**: ${step}`)
  logger.info(`**Reason**: ${reason}`)
  logger.info(``)
  logger.info(`📊 Results: []`)

  return {
    results: [],
    prLinks: {}
  }
}

// Create unified xyne-cli agentic checkpoint configuration for entire workspace
function createUnifiedXyneCliAgenticConfig(
  coderId: string,
  title: string,
  workspacePath: string,
  repositorySetups: CoderRepositorySetup[],
  userPrompt: string,
  buildErrors?: string
): { agentName: string; config: AgenticCheckpointConfig } {
  const repositoryList = repositorySetups.map(repo =>
    `- **${repo.targetRepository}**: ${repo.localPath}`
  ).join('\n')

  // Generate dynamic workspace structure based on actual repositories
  const workspaceStructure = repositorySetups.map(repo =>
    `├── ${repo.targetRepository}/`
  ).join('\n')

  let userMessage = `Implement the following feature/changes across the product repositories:

# CODER TASK INFORMATION
- Coder ID: ${coderId}
- Title: ${title}

# WORKSPACE INFORMATION
- **Working Directory**: ${workspacePath}
- **Important**: All repositories are already cloned and ready for you to work with
- **No git cloning needed**: Just use file_writer to modify files directly

# REPOSITORIES AVAILABLE
${repositoryList}

# USER REQUEST
${userPrompt}

# INSTRUCTIONS
You are working in a unified workspace with all repositories already cloned locally at the path above. Use the file_writer tool to make changes directly to files in these repositories.

**CRITICAL**: Start all file paths from the workspace root: ${workspacePath}

**CRITICAL FOR BASH COMMANDS**: When using the bash tool, you MUST always include the working directory. Never run commands without specifying the directory:
  - ✅ CORRECT: \`cd ${workspacePath}/xyne-spaces/dashboard && npm run type-check\`
  - ❌ WRONG: \`npx tsc --noEmit src/file.ts\` (missing working directory)
  - ✅ CORRECT: \`cd ${workspacePath}/xyne-spaces/dashboard && npx tsc --noEmit src/file.ts\`

Key guidelines:
1. **Cross-repository awareness**: You can see all repositories and understand their relationships
2. **Selective changes**: Only modify repositories that are relevant to the feature request
3. **Consistency**: Ensure changes are consistent across repositories where applicable
4. **Production-ready code**: Follow existing patterns and conventions in each repository
5. **Proper error handling**: Add appropriate error handling and validation
6. **Testing**: Include tests if applicable and update existing tests
7. **Documentation**: Update documentation and comments as needed
8. **Always use absolute paths with cd**: Every bash command must start with \`cd <absolute-path> && <your-command>\`

Example file paths:
- \`${workspacePath}/euler-api-txns/src/handler.hs\`
- \`${workspacePath}/euler-api-gateway/src/main.hs\`
- \`${workspacePath}/offer-engine/lib/OfferEngine.hs\`

The workspace structure:
\`\`\`
${workspacePath}/
${workspaceStructure}
\`\`\`

**Important**: You don't need to handle git operations (commit/push) - that will be handled automatically after you complete your changes.

Focus on implementing clean, well-documented changes that align with the existing codebase architecture.`

  if (buildErrors) {
    userMessage += `\n\n# PREVIOUS BUILD FAILURES
The previous attempt resulted in build errors in some repositories. Please fix the following errors:
\`\`\`
${buildErrors}
\`\`\`

Analyze the errors carefully and make the necessary corrections across all affected repositories.
After making all the changes, provide a summary of what you changed in each repository.`
  }

  // Use first repository as placeholder for required repoInfo (agent won't actually clone it)
  const placeholderRepo = repositorySetups[0]

  return {
    agentName: 'coder-agent',
    config: {
      conversationContext: {
        initialUserMessage: userMessage
      },
      repoInfo: {
        repoUrl: placeholderRepo.repoUrl, // Framework requires this but agent works in our workspace
        repoBranch: placeholderRepo.branch,
        baseBranch: placeholderRepo.baseBranch,
        getCommitMessage: (raw_commit_message) => `CODER-0000 ${raw_commit_message}`
      }
    }
  }
}


export const extractLastMessageContent = (result: ConversationResult): string => {
  const lastMessage = result.messages[result.messages.length - 1]
  return lastMessage?.content || 'No content generated'
}

const CoderWorkflowInputSchema = z.object({
  userPrompt: z.string().min(1, "User prompt is required"),
  product: z.string().min(1, "Product is required"),
  coderId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  selectedRepositories: z.array(z.string()).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignedTo: z.string().optional(),
  labels: z.array(z.string()).optional(),
  humanReadableId: z.string().optional()
})

const coderWorkflowContextMapper = (payload: z.infer<typeof CoderWorkflowInputSchema> & { ticketId: string }): CoderWorkflowContext => ({
  ticketId: payload.ticketId,
  userPrompt: payload.userPrompt,
  product: payload.product,
  coderId: payload.coderId,
  title: payload.title,
  description: payload.description,
  selectedRepositories: payload.selectedRepositories,
  priority: payload.priority,
  assignedTo: payload.assignedTo,
  labels: payload.labels,
  humanReadableId: payload.humanReadableId
})

export const coderWorkflow: WorkflowDefinition<CoderWorkflowContext, CoderWorkflowResult, typeof CoderWorkflowSteps> = {
  type: WorkflowType.CODER_WORKFLOW,
  name: 'Coder Workflow',
  description: 'Implement features and changes across product repositories using AI code generation',
  category: 'Development',
  icon: 'code',
  requiresRepo: false,
  priority: 'medium',
  fields: ['userPrompt', 'product'], // Only these 2 fields required for non-admin users
  inputSchema: CoderWorkflowInputSchema,
  contextMapper: coderWorkflowContextMapper,

  async execute(engine: WorkflowEngine<CoderWorkflowContext, typeof CoderWorkflowSteps>): Promise<CoderWorkflowResult> {
    const context = engine.getContext()
    const {
      userPrompt,
      product,
      selectedRepositories = [],
      coderId = `coder-${randomUUID().slice(0, 8)}`, // Auto-generate if not provided
      title = `Coder Task: ${userPrompt.slice(0, 50)}${userPrompt.length > 50 ? '...' : ''}`, // Auto-generate from prompt
      description = userPrompt // Use prompt as description if not provided
    } = context

    try {
      // Step 1: Validate product and repositories
      const productValidationResult = await engine.createCheckpoint(
        CoderWorkflowSteps.VALIDATE_PRODUCT_AND_REPOS,
        validateProductAndRepos,
        product,
        selectedRepositories
      )

      logger.info(`✅ [VALIDATION] Product validation successful for '${product}' with ${productValidationResult.selectedRepositories.length} repositories`)

      // Step 2: Process user prompt
      const promptProcessingResult = await engine.createCheckpoint(
        CoderWorkflowSteps.PROCESS_USER_PROMPT,
        processUserPrompt,
        coderId,
        userPrompt,
        productValidationResult.selectedRepositories
      )

      logger.info(`✅ [VALIDATION] User prompt processed successfully`)

      // Step 3: Setup unified workspace with all repositories
      const workspaceSetupResult = await engine.createCheckpoint(
        CoderWorkflowSteps.REPOSITORY_SETUP,
        setupUnifiedWorkspace,
        coderId,
        productValidationResult.selectedRepositories
      )

      const repositorySetups = workspaceSetupResult.repositorySetups || []
      const workspacePath = workspaceSetupResult.workspacePath

      if (!repositorySetups || repositorySetups.length === 0) {
        throw new CodeGenerationError('SETUP', 'Unified workspace setup failed - no repositories configured')
      }

      if (!workspacePath) {
        throw new CodeGenerationError('SETUP', 'Unified workspace path not available')
      }

      logger.info(`✅ [VALIDATION] Unified workspace setup successful for ${repositorySetups.length} repositories`)

      // Step 4: Product-level code generation and build verification with retry
      const codeFixesResults: CoderCodeFixResult[] = []
      const MAX_PRODUCT_RETRY_ATTEMPTS = 3
      let productBuildErrors = ''

      // Product-level retry loop (retry entire product, not per repo)
      await engine.createWhileLoop(
        CoderWorkflowSteps.CODE_FIX_LOOP,
        MAX_PRODUCT_RETRY_ATTEMPTS,
        async (retryIteration: number, retryEngine: WorkflowEngine<CoderWorkflowContext, typeof CoderWorkflowSteps>) => {
          logger.info(`🎯 [CODER-DEBUG] Product-level attempt: ${retryIteration + 1}/${MAX_PRODUCT_RETRY_ATTEMPTS}`)

          // Create unified agentic checkpoint for entire product
          const agenticConfig = createUnifiedXyneCliAgenticConfig(
            coderId,
            title,
            workspacePath,
            repositorySetups,
            promptProcessingResult.processedPrompt,
            productBuildErrors
          )

          // Execute code generation across entire workspace
          const agenticResult = await retryEngine.createAgenticCheckpoint(
            CoderWorkflowSteps.MAKING_AGENTIC_CODE_CHANGES,
            agenticConfig.agentName,
            agenticConfig.config
          )

          // Clean up framework's cloned repository if it exists
          if (agenticResult.gitInfo.workingDirectory) {
            try {
              await rm(agenticResult.gitInfo.workingDirectory, { recursive: true, force: true })
              logger.info(`🧹 [FRAMEWORK-CLEANUP] Cleaned up framework repository: ${agenticResult.gitInfo.workingDirectory}`)
            } catch (cleanupError) {
              logger.warn(`⚠️ [FRAMEWORK-CLEANUP] Failed to cleanup framework repository:`, cleanupError)
            }
          }

          // Detect which repositories have changes
          const changedRepositories = await detectRepositoryChanges(repositorySetups)

          if (changedRepositories.length === 0) {
            logger.info("⚠️ [CODER-DEBUG] No changes detected in any repository, retrying...")
            return LoopControl.CONTINUE
          }

          logger.info(`📝 [CODER-DEBUG] Changes detected in ${changedRepositories.length} repositories: ${changedRepositories.join(', ')}`)

          try {
            // Commit and push changes for modified repositories
            const commitHashes = await commitAndPushChanges(
              repositorySetups,
              changedRepositories,
              `CODER-0000 ${title || 'Feature implementation'}`
            )

            // Build only the repositories that have changes
            const buildResults = await buildModifiedRepositories(repositorySetups, changedRepositories)

            // Check if all builds succeeded
            const failedBuilds = Object.entries(buildResults).filter(([, result]) => !result.success)

            if (failedBuilds.length === 0) {
              // All builds successful

              // Extract user description and code changes summary
              const user_description = description || title || 'No description provided'
              const lastAssistantMsg = agenticResult.result.messages
                .filter(msg => msg.type === 'assistant')
                .pop()
              const full_codeChangesSummary = lastAssistantMsg?.content || 'No summary available'

              // Create results for successful repositories
              for (const repoName of changedRepositories) {
                const commitHash = commitHashes[repoName]
                const repoSetup = repositorySetups.find(r => r.targetRepository === repoName)

                codeFixesResults.push({
                  repository: repoName,
                  success: true,
                  branchName: repoSetup?.branch,
                  executedAt: new Date().toISOString(),
                  userDescription: user_description,
                  codeChangesSummary: full_codeChangesSummary,
                  latestCommit: commitHash
                })
              }

              // Populate multi-repo GitInfo for UI display
              const multiRepoResults: { [repoName: string]: any } = {}
              for (const repoName of changedRepositories) {
                const commitHash = commitHashes[repoName]
                const repoSetup = repositorySetups.find(r => r.targetRepository === repoName)

                if (repoSetup && commitHash) {
                  const prLink = generatePrLink(repoName, repoSetup.branch, repoSetup.baseBranch)
                  
                  multiRepoResults[repoName] = {
                    branch: repoSetup.branch,
                    commitHash: commitHash,
                    repoUrl: repoSetup.repoUrl,
                    success: true,
                    pr_link: prLink
                  }
                }
              }

              // Update the agenticResult gitInfo with multi-repo information
              agenticResult.gitInfo.multiRepoResults = multiRepoResults

              logger.info(`✅ [VALIDATION] Product-level success: All ${changedRepositories.length} modified repositories built successfully`)
              return LoopControl.BREAK // Success - stop retrying!

            } else {
              // Some builds failed - prepare error feedback for next retry
              const errorMessages = failedBuilds.map(([repo, result]) =>
                `${repo}: ${result.error || 'Unknown build error'}`
              ).join('\n\n')

              productBuildErrors = `Build failures in ${failedBuilds.length} repositories:\n\n${errorMessages}`

              if (retryIteration < MAX_PRODUCT_RETRY_ATTEMPTS - 1) {
                logger.info(`🔄 [BUILD-CHECK] Product retry ${retryIteration + 2}/${MAX_PRODUCT_RETRY_ATTEMPTS} due to build failures`)
                return LoopControl.CONTINUE // Continue to next attempt
              } else {
                // Last attempt failed - record failures and throw error
                for (const [repoName, result] of failedBuilds) {
                  codeFixesResults.push({
                    repository: repoName,
                    success: false,
                    error: result.error || 'Build failed',
                    executedAt: new Date().toISOString()
                  })
                }

                logger.error(`❌ [BUILD-CHECK] All ${MAX_PRODUCT_RETRY_ATTEMPTS} product-level attempts exhausted`)
                // Throw error to mark the loop as failed in UI
                throw new CodeGenerationError('BUILD_FAILED', `Build failed after ${MAX_PRODUCT_RETRY_ATTEMPTS} attempts: ${errorMessages}`)
              }
            }

          } catch (error) {
            // Commit/push/build operation failed
            const errorMessage = error instanceof Error ? error.message : String(error)
            const errorStack = error instanceof Error ? error.stack : undefined
            productBuildErrors = `Product operation failed: ${errorMessage}`

            // Store detailed error information for UI display
            const detailedError = {
              errorMessage,
              errorType: 'PRODUCT_OPERATION_FAILED',
              errorDetails: errorStack,
              failedAt: new Date().toISOString(),
              retryAttempt: retryIteration + 1,
              maxRetries: MAX_PRODUCT_RETRY_ATTEMPTS
            }

            if (retryIteration < MAX_PRODUCT_RETRY_ATTEMPTS - 1) {
              logger.info(`🔄 [PRODUCT-ERROR] Retrying due to: ${errorMessage}`)
              return LoopControl.CONTINUE
            } else {
              // Last attempt failed - record failures and throw error
              for (const repoName of changedRepositories) {
                codeFixesResults.push({
                  repository: repoName,
                  success: false,
                  error: errorMessage,
                  errorDetails: detailedError,
                  executedAt: new Date().toISOString()
                })
              }

              // Also update agenticResult with failure information for UI
              agenticResult.gitInfo.hasCommits = false
              if (!agenticResult.gitInfo.multiRepoResults) {
                agenticResult.gitInfo.multiRepoResults = {}
              }

              // Mark all attempted repositories as failed in GitInfo
              for (const repoName of changedRepositories) {
                const repoSetup = repositorySetups.find(r => r.targetRepository === repoName)
                const prLink = repoSetup ? generatePrLink(repoName, repoSetup.branch, repoSetup.baseBranch) : undefined

                agenticResult.gitInfo.multiRepoResults[repoName] = {
                  branch: repoSetup?.branch || 'unknown',
                  commitHash: '',
                  repoUrl: repoSetup?.repoUrl || 'unknown',
                  success: false,
                  error: errorMessage,
                  pr_link: prLink
                }
              }

              // Throw error to mark the loop as failed in UI
              throw new CodeGenerationError('BUILD_FAILED', `All ${MAX_PRODUCT_RETRY_ATTEMPTS} build attempts failed: ${errorMessage}`)
            }
          }
        }
      )

      // Clean up workspace
      try {
        await rm(workspacePath, { recursive: true, force: true })
        logger.info(`🧹 [CODER_WORKFLOW] Cleaned up workspace: ${workspacePath}`)
      } catch (cleanupError) {
        logger.warn(`⚠️ [CODER_WORKFLOW] Failed to cleanup workspace:`, cleanupError)
      }

      // Validate that at least some code fixes were successful
      const successfulFixes = codeFixesResults.filter(fix => fix.success && fix.latestCommit)
      if (codeFixesResults.length > 0 && successfulFixes.length === 0) {
        const failedRepos = codeFixesResults.map(fix =>
          `${fix.repository}: ${fix.error || 'Unknown error'}`
        ).join('; ')

        throw new CodeGenerationError('ALL_REPOS', `All product attempts failed - ${failedRepos}`)
      }

      logger.info(`📊 [CODER-DEBUG] Product workflow completed. Results:`, codeFixesResults)
      logger.info(`✅ [VALIDATION] Successfully completed ${successfulFixes.length}/${codeFixesResults.length} repositories`)
      logger.info(`🎉 [WORKFLOW-DEBUG] Coder workflow completed successfully for ${coderId}`)

      // Generate summary with results and PR links for UI display
      const workflowSummary = await engine.createCheckpoint(
        CoderWorkflowSteps.GENERATE_SUMMARY,
        async () => formatWorkflowSummary(codeFixesResults, repositorySetups)
      )

      // Return successful results
      return {
        results: codeFixesResults,
        prLinks: workflowSummary.prLinks
      }

    } catch (error) {
      logger.error(`❌ [WORKFLOW-DEBUG] Coder workflow failed for ${coderId}:`, error)

      // Enhanced error detection to identify which step failed
      let step = 'WORKFLOW_EXCEPTION'
      let reason = `Unexpected workflow error: ${error instanceof Error ? error.message : 'Unknown error'}`

      if (error instanceof Error) {
        logger.error(`❌ [WORKFLOW-DEBUG] Error message: ${error.message}`)
        logger.error(`❌ [WORKFLOW-DEBUG] Error stack: ${error.stack}`)

        // Detect specific failure steps based on error type and stack trace
        if (error instanceof ProductValidationError) {
          step = 'PRODUCT_VALIDATION'
          reason = error.message
        } else if (error instanceof RepositoryValidationError) {
          step = 'REPOSITORY_VALIDATION'
          reason = error.message
        } else if (error instanceof CodeGenerationError) {
          step = 'CODE_GENERATION'
          reason = error.message
        } else {
          const stack = error.stack || ''

          if (stack.includes('validateProductAndRepos') || stack.includes('product')) {
            step = 'PRODUCT_VALIDATION'
            reason = error.message
          } else if (stack.includes('processUserPrompt')) {
            step = 'PROMPT_PROCESSING'
            reason = 'User prompt processing failed: ' + error.message
          } else if (stack.includes('setupUnifiedWorkspace')) {
            step = 'WORKSPACE_SETUP'
            reason = error.message
          } else if (stack.includes('createAgenticCheckpoint') || stack.includes('code_fix')) {
            step = 'CODE_GENERATION'
            reason = error.message
          }
        }

        logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`)
      }

      // Generate failure summary for UI display
      const failureSummary = await engine.createCheckpoint(
        CoderWorkflowSteps.GENERATE_SUMMARY,
        async () => formatFailureSummary(step, reason)
      )

      return {
        results: [],
        prLinks: failureSummary.prLinks,
        failureInfo: {
          step: step,
          reason: reason
        }
      }
    }
  }
}