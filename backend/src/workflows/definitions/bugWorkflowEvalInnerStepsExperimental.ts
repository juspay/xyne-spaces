
import { WorkflowEngine, LoopControl, AgenticCheckpointConfig } from '../workflow-types'
import { WorkflowDefinition } from '../registry/workflowRegistry'
import { WorkflowType, BugWorkflowEvalContext, BugWorkflowEvalOutput } from '../types/workflow-enums'
import type { ConversationResult } from '@framework'
import { randomUUID } from 'crypto'
import { cloneRepository, cleanupRepository } from '@framework'
import { z } from 'zod'
import {logger} from '@/utils/logger';

// Step IDs for bug workflow eval inner steps experimental
export enum BugWorkflowEvalInnerStepsExperimentalSteps {
  AUTONOMOUS_ANALYSIS = 'autonomous_analysis',
  PARSE_AGENT_OUTPUT = 'parse_agent_output',
  REPOSITORY_SETUP = 'repository_setup',
  CODE_FIX = 'code_fix',
  GENERATE_FIX = 'generate_fix',
  EVALUATION = 'evaluation'
}

// Reuse existing types
interface CodeFixResult {
  repository: string;
  changeSummary: string;
  success: boolean;
  branchName?: string;
  latestCommit?: string;
  error?: string;
  executedAt: string;
}

interface RepoInfo {
  repo: string;
  changes: string;
}

// Combined analysis prompt that merges all 4 prompts from the original workflow
function buildCombinedAnalysisPrompt(
  title: string,
  description: string,
  severity: string,
  clonedRepoPaths: string[]
): string {
  const repoPathsList = clonedRepoPaths.map((path, idx) => `${idx + 1}. ${path}`).join('\n')

  return `You are an expert software debugging AI with deep knowledge of distributed systems. Your task is to perform a complete bug analysis across multiple repositories.

# ⚠️ CRITICAL: DEEP EXPLORATION IS MANDATORY ⚠️

**DO NOT** rush to provide answers. You MUST:
1. **Explore extensively** - Use 100+ tool calls before concluding
2. **Read actual code** - Don't guess, read the real implementation
3. **Trace execution paths** - Follow the bug from entry to failure point
4. **Verify with git history** - Check when/why problematic code was added
5. **Build evidence** - Every claim must be backed by actual code you've read

# AVAILABLE REPOSITORIES (Cloned to Filesystem)

You have access to the following cloned repositories on the filesystem:
${repoPathsList}

# BUG INFORMATION

**Title**: ${title}
**Description**: ${description}
**Severity**: ${severity}

# EXPLORATION STRATEGY (FOLLOW THIS)

## Step 1: Understand the System

## Step 2: Locate Relevant Code

## Step 3: Deep Code Analysis
- Follow function calls to understand data flow
- Read related utility functions and helpers
- Examine error handling and validation logic
- Check tests to understand expected behavior

## Step 4: Verify and Document
- Re-read key sections to confirm your understanding
- Search for similar patterns in other repos
- Verify your solution aligns with existing patterns

# YOUR TASK

**Only AFTER completing thorough exploration above**, perform analysis in 4 stages and output results in a single structured JSON format.

---

## STAGE 1: Expand Problem Statement

Analyze the bug and expand it into a clear, structured, and testable problem statement.

Output the following in your JSON:
- **llm_understanding**: Your concise understanding of what the issue is about
- **expected_behavior**: What should ideally happen in the system
- **observed_behavior**: What is currently happening (the bug)
- **test_case_to_reproduce**: Detailed steps to reproduce the bug
- **test_case_post_fix**: Steps to verify the fix works

---

## STAGE 2: Root Cause Analysis (RCA)

Carefully analyze the bug and infer its possible technical cause based on the codebase.

Steps:
1. Use grep/glob to search for relevant files and functions
2. Use read to examine code in detail
3. Use bash commands (git log, git blame) to check history
4. Identify the root cause with evidence

Output an array of RCA findings, each with:
- **repo_name**: Repository where the issue is found
- **function_name**: Function with the issue
- **module_name**: File/module name
- **code_snippet**: Relevant code snippet
- **reason**: Why this code is the root cause (1-2 sentences)

---

## STAGE 3: Correction of Error (COE)

Create a detailed correction plan based on your RCA.

Describe:
1. Clear plan to correct the error
2. Repositories, files, and modules to modify
3. Exact changes required (e.g., fix logic flaw, add validation, etc.)
4. Step-by-step implementation guide
5. How this addresses the RCA

Output a markdown-formatted correction plan.

---

## STAGE 4: Multi-Repository Change Plan

Translate the RCA and COE into specific, repository-level code change instructions.

For each repository that needs changes:
- **repo**: Repository name (must match one of the cloned repos)
- **changes**: Precise description of code changes needed
- **affected_files**: List of files to modify (if known)
- **rationale**: Why these changes fix the issue

Only include repos that actually need changes.

---

# OUTPUT FORMAT (CRITICAL)

You MUST output a single JSON block at the end with this exact structure:

\`\`\`json
{
  "problem_statement": {
    "llm_understanding": "...",
    "expected_behavior": "...",
    "observed_behavior": "...",
    "test_case_to_reproduce": "...",
    "test_case_post_fix": "..."
  },
  "rca": [
    {
      "repo_name": "...",
      "function_name": "...",
      "module_name": "...",
      "code_snippet": "...",
      "reason": "..."
    }
  ],
  "coe": "# Correction Plan\n\n...(markdown formatted)...",
  "multi_repo_coe_analysis": {
    "repos": [
      {
        "repo": "euler-api-customer",
        "changes": "Detailed changes...",
        "affected_files": ["file1.ts", "file2.ts"],
        "rationale": "..."
      }
    ]
  }
}
\`\`\`

# ⚠️ FINAL REMINDERS BEFORE YOU START ⚠️

## Evidence Requirements (NON-NEGOTIABLE)
- **Every RCA finding** must cite actual code you've read with \`read\`
- **Every code snippet** must be copied from real files, not fabricated
- **Every file path** must be verified to exist with \`ls\` or \`glob\`
- **Every repository mentioned** in multi_repo_coe_analysis must be one you've explored

## Minimum Exploration Standards
- ✅ **At least 100 tool calls** before outputting JSON
- ✅ **At least 20-30 files read** using the \`read\` tool
- ✅ **At least 5-8 repositories explored** with \`ls\` and \`grep\`
- ✅ **Git history checked** for key files with \`bash git log\` / \`bash git blame\`

## Quality Over Speed
- 🚫 **DO NOT** guess or assume - verify everything by reading code
- 🚫 **DO NOT** output JSON until you've completed all 5 exploration phases above
- 🚫 **DO NOT** rush - take the time needed to build a solid understanding
- ✅ **DO** trace execution paths through multiple files
- ✅ **DO** verify your hypotheses by reading related code

## JSON Output Requirements
- Return ONLY valid JSON in the exact format specified above
- Include ALL four required sections: problem_statement, rca, coe, multi_repo_coe_analysis
- Ensure repo names in multi_repo_coe_analysis match the cloned repositories EXACTLY
- Provide specific, actionable, implementation-ready descriptions

---

**Now begin your DEEP, THOROUGH exploration. Remember: Quality analysis takes time. Use as many tool calls as needed!**`
}

// Clone all candidate repos upfront (NOT a checkpoint)
async function cloneAllCandidateRepos(bugId: string, commits?: BugWorkflowEvalContext['commits']): Promise<{
  clonedRepoPaths: string[]
  repoPathsMap: Record<string, string>
  primaryRepoUrl: string
  primaryRepoBranch: string
  primaryRepoBaseBranch: string
}> {
  const candidateRepos = [
    'euler-api-txns',
    'euler-api-customer',
    'euler-api-order',
    'euler-api-gateway',
    'euler-api-cards',
    'euler-api-pre-txn',
    'euler-api-token',
    'euler-api-dashboard',
    'offer-engine'
  ]

  const clonedRepoPaths: string[] = []
  const repoPathsMap: Record<string, string> = {}

  // Clone n-1 repos (all except the primary one we'll use for git operations)
  const primaryRepo = candidateRepos[0] // Use first repo as primary
  const reposToClone = candidateRepos.slice(0, -1) // Clone all but last one

  for (const repo of reposToClone) {
    const repoUrl = repo === 'euler-api-gateway'
      ? `ssh://git@github.com/example-org/${repo}.git`
      : `ssh://git@github.com/example-org/${repo}.git`

    const baseBranch = commits?.[repo as keyof typeof commits] || 'staging'

    try {
      const { repoPath } = await cloneRepository(
        repoUrl,
        `${bugId}-analysis-${repo}`,
        baseBranch
      )

      clonedRepoPaths.push(repoPath)
      repoPathsMap[repo] = repoPath
      logger.info(`✅ Cloned ${repo} to ${repoPath}`)
    } catch (error) {
      logger.error(`❌ Failed to clone ${repo}:`, error)
      // Continue with other repos even if one fails
    }
  }

  // Get primary repo details (the one we'll pass to createAgenticCheckpoint)
  const primaryRepoUrl = primaryRepo === 'euler-api-gateway'
    ? `ssh://git@github.com/example-org/${primaryRepo}.git`
    : `ssh://git@github.com/example-org/${primaryRepo}.git`

  const primaryRepoBaseBranch = commits?.[primaryRepo as keyof typeof commits] || 'staging'
  const primaryRepoBranch = `EUL-0000-bugfix-${bugId}-${primaryRepo}-${randomUUID()}`

  return {
    clonedRepoPaths,
    repoPathsMap,
    primaryRepoUrl,
    primaryRepoBranch,
    primaryRepoBaseBranch
  }
}

// Create agentic config for autonomous analysis using config-based approach
function createAutonomousAnalysisConfig(
  title: string,
  description: string,
  severity: string,
  clonedRepoPaths: string[],
  primaryRepoUrl: string,
  primaryRepoBranch: string,
  primaryRepoBaseBranch: string
): { agentName: string; config: AgenticCheckpointConfig } {
  const userMessage = buildCombinedAnalysisPrompt(title, description, severity, clonedRepoPaths)

  return {
    agentName: 'autonomous-bug-analyzer',
    config: {
      conversationContext: {
        initialUserMessage: userMessage
      },
      repoInfo: {
        repoUrl: primaryRepoUrl,
        repoBranch: primaryRepoBranch,
        baseBranch: primaryRepoBaseBranch
      }
    }
  }
}

// Parse agent's JSON output - pure function
const parseAgentOutput = async (agentResult: ConversationResult) => {
  // Get the last message content
  const lastMessage = agentResult.messages[agentResult.messages.length - 1]
  const content = lastMessage?.content || ''

  logger.info('Agent output:', content)

  // Extract JSON from the response
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/)
  let analysis

  if (jsonMatch && jsonMatch[1]) {
    try {
      analysis = JSON.parse(jsonMatch[1])
    } catch (error) {
      logger.error('Failed to parse agent JSON:', error)
      throw new Error(`Agent output is not valid JSON: ${error}`)
    }
  } else {
    // Try parsing the entire content as JSON
    try {
      analysis = JSON.parse(content)
    } catch (error) {
      logger.error('Agent did not output required JSON format')
      throw new Error('Agent did not output required JSON format')
    }
  }

  // Validate the structure
  if (!analysis.problem_statement || !analysis.rca || !analysis.coe || !analysis.multi_repo_coe_analysis) {
    throw new Error('Agent output is missing required fields')
  }

  return {
    problemStatement: {
      expanded_problem: analysis.problem_statement
    },
    rca: analysis.rca,
    coe: analysis.coe,
    multi_repo_coe_analysis: analysis.multi_repo_coe_analysis
  }
}

// Repository setup - pure function
const repositorySetupCallback = async (
  bugId: string,
  multiRepoAnalysis: { repos: Array<{ repo: string; changes: string }> },
  commits?: BugWorkflowEvalContext['commits']
) => {
  logger.info(`📦 [REPO-DEBUG] Starting repository setup for bug: ${bugId}`)

  if (!multiRepoAnalysis || !multiRepoAnalysis.repos || multiRepoAnalysis.repos.length === 0) {
    throw new Error("Multi-repo analysis is not available or is empty.")
  }

  const repositorySetups = []

  for (const repoInfo of multiRepoAnalysis.repos) {
    const targetRepository = repoInfo.repo
    const cloneUrl = targetRepository === 'euler-api-gateway'
      ? `ssh://git@github.com/example-org/euler-api-gateway.git`
      : `ssh://git@github.com/example-org/${targetRepository}.git`

    let baseBranch = 'staging'
    if (commits && commits[targetRepository as keyof typeof commits]) {
      baseBranch = commits[targetRepository as keyof typeof commits]!
    }

    const jiraId = 'EUL-0000'
    const branchName = `${jiraId}-bugfix-${bugId}-${targetRepository}-${randomUUID()}`

    repositorySetups.push({
      targetRepository: targetRepository,
      changeSummary: repoInfo.changes,
      repoUrl: cloneUrl,
      branch: branchName,
      baseBranch: baseBranch,
      setupAt: new Date().toISOString()
    })
  }

  return repositorySetups
}

// Create agentic config for code fixes using config-based approach
function createXyneCliAgenticConfig(
  bugId: string,
  title: string,
  repository: string,
  changes: string,
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  buildErrors?: string
): { agentName: string; config: AgenticCheckpointConfig } {
  let userMessage = `Implement the following bug fix for repository "${repository}":

# BUG INFORMATION
- Bug ID: ${bugId}
- Title: ${title}

# REQUIRED CHANGES
${changes}

# INSTRUCTIONS
Please implement the necessary code changes as described above. Use the file_writer tool to make changes. Ensure the code is production-ready and follows existing coding standards.`

  if (buildErrors) {
    userMessage += `\n\n# PREVIOUS BUILD FAILED
The previous attempt resulted in build errors. Please fix the following errors:
\`\`\`
${buildErrors}
\`\`\`

Analyze the errors carefully and make the necessary corrections.
After make all the changes can you give the summary of what are the things that you changed here properly`
  }

  return {
    agentName: 'bug-fix-engineer',
    config: {
      conversationContext: {
        initialUserMessage: userMessage
      },
      repoInfo: {
        repoUrl,
        repoBranch: repoBranch,
        baseBranch: baseBranch
      }
    }
  }
}

// Extract last message content
export const extractLastMessageContent = (result: ConversationResult): string => {
  const lastMessage = result.messages[result.messages.length - 1]
  return lastMessage?.content || 'No content generated'
}

const BugWorkflowEvalExperimentalInputSchema = z.object({
  bugId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  reportedBy: z.string(),
  merchantId: z.string().optional(),
  assignedTo: z.string().optional(),
  labels: z.array(z.string()).optional(),
  codeFiles: z.array(z.string()).optional(),
  humanReadableId: z.string().optional(),
  pr_url: z.string().optional(),
  commits: z.record(z.string()).optional()
})

const bugWorkflowEvalExperimentalContextMapper = (payload: z.infer<typeof BugWorkflowEvalExperimentalInputSchema> & { ticketId: string }): BugWorkflowEvalContext => ({
  ticketId: payload.ticketId,
  bugId: payload.bugId,
  title: payload.title,
  description: payload.description,
  severity: payload.severity,
  reportedBy: payload.reportedBy,
  merchantId: payload.merchantId,
  assignedTo: payload.assignedTo,
  labels: payload.labels,
  codeFiles: payload.codeFiles,
  humanReadableId: payload.humanReadableId,
  pr_url: payload.pr_url,
  commits: payload.commits
})

// Main workflow definition
export const bugWorkflowEvalInnerStepsExperimental: WorkflowDefinition<BugWorkflowEvalContext, BugWorkflowEvalOutput, typeof BugWorkflowEvalInnerStepsExperimentalSteps, any> = {
  type: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL,
  name: 'Bug Workflow Eval Inner Steps (Experimental)',
  description: 'Experimental bug resolution workflow with autonomous agent analysis across cloned repositories',
  inputSchema: BugWorkflowEvalExperimentalInputSchema,
  contextMapper: bugWorkflowEvalExperimentalContextMapper,

  async execute(engine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerStepsExperimentalSteps>): Promise<BugWorkflowEvalOutput> {
    const context = engine.getContext()
    const { bugId, title, description, severity, commits } = context

    logger.info(`🚀 [EXPERIMENTAL-WORKFLOW] Starting experimental bug analysis for ${bugId}`)

    // Step 1: Clone all candidate repos (NOT a checkpoint - just direct code)
    logger.info('📦 Cloning candidate repositories...')
    const {
      clonedRepoPaths,
      repoPathsMap,
      primaryRepoUrl,
      primaryRepoBranch,
      primaryRepoBaseBranch
    } = await cloneAllCandidateRepos(bugId, commits)

    logger.info(`✅ Cloned ${clonedRepoPaths.length} repositories`)
    logger.info('Repo paths:', repoPathsMap)

    // Step 2: Single autonomous analysis agentic checkpoint
    logger.info('🤖 Starting autonomous bug analysis...')
    const analysisConfig = createAutonomousAnalysisConfig(
      title,
      description,
      severity,
      clonedRepoPaths,
      primaryRepoUrl,
      primaryRepoBranch,
      primaryRepoBaseBranch
    )

    const agentResult = await engine.createAgenticCheckpoint(
      BugWorkflowEvalInnerStepsExperimentalSteps.AUTONOMOUS_ANALYSIS,
      analysisConfig.agentName,
      analysisConfig.config
    )

    logger.info('✅ Autonomous analysis complete')

    // Step 3: Parse agent output - pure function call
    const analysisResults = await engine.createCheckpoint(
      BugWorkflowEvalInnerStepsExperimentalSteps.PARSE_AGENT_OUTPUT,
      parseAgentOutput,
      agentResult.result
    )

    logger.info('✅ Parsed agent output:', {
      problemStatement: analysisResults.problemStatement,
      rcaCount: analysisResults.rca?.length,
      reposToFix: analysisResults.multi_repo_coe_analysis?.repos?.length
    })

    // Step 4: Repository setup - pure function call
    const repositorySetups = await engine.createCheckpoint(
      BugWorkflowEvalInnerStepsExperimentalSteps.REPOSITORY_SETUP,
      repositorySetupCallback,
      bugId,
      analysisResults.multi_repo_coe_analysis,
      commits
    )

    logger.info('✅ Repository setup complete:', repositorySetups)

    // Step 5: Code fixes with retry loop
    if (!repositorySetups || repositorySetups.length === 0) {
      throw new Error('Repository setups not available or failed')
    }

    if (!analysisResults.multi_repo_coe_analysis || !analysisResults.multi_repo_coe_analysis.repos) {
      throw new Error('Multi-repo analysis is not available.')
    }

    const codeFixesResults: CodeFixResult[] = []

    // Process each repository
    for (const repoSetup of repositorySetups) {
      const repoInfo = analysisResults.multi_repo_coe_analysis.repos.find((r: RepoInfo) => r.repo === repoSetup.targetRepository)
      if (!repoInfo) {
        logger.warn(`No changes specified for ${repoSetup.targetRepository}. Skipping.`)
        continue
      }

      const { targetRepository } = repoSetup
      logger.info(`🎯 [XYNE-DEBUG] Processing repository: ${targetRepository}`)

      const buildErrorFeedback = ''
      let repoSuccess = false

      // Retry loop for this repository (max 3 attempts)
      await engine.createWhileLoop(
        BugWorkflowEvalInnerStepsExperimentalSteps.CODE_FIX,
        3,
        async (iteration: number, scopedEngine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalInnerStepsExperimentalSteps>) => {
          logger.info(`🔄 [XYNE-DEBUG] Attempt ${iteration + 1}/3 for ${targetRepository}`)

          // Create agentic checkpoint for code generation
          const agenticConfig = createXyneCliAgenticConfig(
            bugId,
            title,
            targetRepository,
            JSON.stringify(repoInfo.changes, null, 2),
            repoSetup.repoUrl,
            repoSetup.branch,
            repoSetup.baseBranch,
            buildErrorFeedback
          )

          // Execute as agentic checkpoint
          const result = await scopedEngine.createAgenticCheckpoint(
            BugWorkflowEvalInnerStepsExperimentalSteps.GENERATE_FIX,
            agenticConfig.agentName,
            agenticConfig.config
          )

          logger.info(`✅ [XYNE-DEBUG] Agentic code generation completed for ${targetRepository}`)

          codeFixesResults.push({
            repository: targetRepository,
            changeSummary: extractLastMessageContent(result.result),
            success: true,
            branchName: repoSetup.branch,
            latestCommit: result.gitInfo.commitHash,
            executedAt: new Date().toISOString()
          })

          repoSuccess = true
          return LoopControl.BREAK // Success!
        }
      )

      // If all retries failed, record the failure
      if (!repoSuccess) {
        logger.error(`❌ [XYNE-DEBUG] All attempts failed for ${targetRepository}`)
        codeFixesResults.push({
          repository: targetRepository,
          changeSummary: "Can't create summary due to failed code generation",
          success: false,
          error: buildErrorFeedback || 'All retry attempts exhausted',
          executedAt: new Date().toISOString(),
          latestCommit: undefined
        })
      }
    }

    logger.info(`📊 [XYNE-DEBUG] Code fixes completed. Results:`, codeFixesResults)

    // Step 6: Evaluation - make it a pure function call
    await engine.createCheckpoint(
      BugWorkflowEvalInnerStepsExperimentalSteps.EVALUATION,
      async (bugIdParam: string, prUrl?: string, commitsParam?: BugWorkflowEvalContext['commits']) => {
        logger.info(`BUG WORKFLOW EVALUATION (EXPERIMENTAL) FOR BUG ID: ${bugIdParam}`)
        logger.info(`Evaluating the results for bug: ${bugIdParam}`)
        logger.info(`PR URL: ${prUrl}`)
        logger.info(`Commits: ${JSON.stringify(commitsParam, null, 2)}`)
        await new Promise(resolve => setTimeout(resolve, 1000))
        return { evaluated: true }
      },
      bugId,
      context.pr_url,
      commits
    )

    // Cleanup cloned repos
    logger.info('🧹 Cleaning up cloned repositories...')
    for (const [repo, path] of Object.entries(repoPathsMap)) {
      try {
        await cleanupRepository(path)
        logger.info(`✅ Cleaned up ${repo}`)
      } catch (error) {
        logger.error(`Failed to cleanup ${repo}:`, error)
      }
    }

    logger.info(`🎉 [EXPERIMENTAL-WORKFLOW] Bug workflow completed successfully for ${bugId}`)

    // Return the final output
    return {
      problemStatement: analysisResults.problemStatement,
      rca: analysisResults.rca,
      coe: analysisResults.coe,
      multi_repo_coe_analysis: analysisResults.multi_repo_coe_analysis,
      repositorySetups,
      codeFixesResults
    } as unknown as BugWorkflowEvalOutput
  }
}
