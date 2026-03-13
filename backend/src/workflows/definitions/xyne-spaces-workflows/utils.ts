/**
 * Xyne Spaces Workflow Utilities
 *
 * This module contains shared utilities and configurations for Xyne Spaces specific workflows.
 * It provides helper functions for creating agent configurations, parsing results, and
 * managing workflow state across different phases of feature implementation.
 */

import { createUserMessage, type ConversationResult } from '@framework'
import { AgenticCheckpointConfig, ExecutorType, GitInfo } from '../../workflow-types'
import { ImageAttachment } from '../../types/workflow-enums'
import * as fs from 'fs/promises'
import * as path from 'path'
import { spawn } from 'child_process'
import { access } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/utils/logger';

// Cache for tracking already-installed repos within a session
const installedRepos = new Map<string, number>()
const INSTALL_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Install dependencies for Xyne Spaces projects
 * This is specific to the xyne-spaces repository structure
 */
export const installXyneSpacesDependencies = async (repoPath: string, repoName: string): Promise<void> => {
  const installKey = `${repoPath}:${repoName}`

  // Check cache
  const timestamp = installedRepos.get(installKey)
  if (timestamp && Date.now() - timestamp < INSTALL_CACHE_TTL) {
    return
  }

  // Check if this is a xyne-spaces repo by looking for backend/package.json
  try {
    await access(join(repoPath, 'backend', 'package.json'))
  } catch {
    return
  }

  logger.info(`[INSTALL-DEPS] Installing dependencies for ${repoName}`)

  const packages = ['shared', 'framework', 'backend', 'dashboard']

  const installPromises = packages.map(async (pkg) => {
    const pkgPath = join(repoPath, pkg)
    try {
      await access(join(pkgPath, 'package.json'))
    } catch {
      return
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const needsBuild = pkg === 'shared' || pkg === 'framework'
        const installProcess = needsBuild
          ? spawn('bash', ['-c', 'NODE_ENV=development npm install --force && npm run build'], {
            cwd: pkgPath,
            stdio: ['inherit', 'pipe', 'pipe']
          })
          : spawn('npm', ['install', '--force'], {
            cwd: pkgPath,
            stdio: ['inherit', 'pipe', 'pipe']
          })

        let completed = false
        let stderr = ''

        const timeoutId = setTimeout(() => {
          if (completed) return
          completed = true
          installProcess.kill()
          logger.warn(`[INSTALL-DEPS] ${pkg} install timeout after 10 minutes`)
          reject(new Error(`Installation timeout for ${pkg}`))
        }, 600000)

        installProcess.stdout?.on('data', () => { })

        installProcess.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        installProcess.on('close', (code) => {
          if (completed) return
          completed = true
          clearTimeout(timeoutId)
          if (code !== 0) {
            const errorDetails = stderr ? `: ${stderr.slice(0, 500)}` : ''
            logger.warn(`[INSTALL-DEPS] ${pkg} install failed with exit code ${code}${errorDetails}`)
            reject(new Error(`Installation failed for ${pkg} with exit code ${code}${errorDetails}`))
          } else {
            logger.info(`[INSTALL-DEPS] ${pkg} installed successfully`)
            resolve()
          }
        })

        installProcess.on('error', (error) => {
          if (completed) return
          completed = true
          clearTimeout(timeoutId)
          reject(error)
        })
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn(`[INSTALL-DEPS] Failed to install ${pkg}: ${errorMessage}`)
    }
  })
  await Promise.allSettled(installPromises)

  // Update cache and cleanup old entries
  installedRepos.set(installKey, Date.now())
  if (installedRepos.size > 1000) {
    const cutoff = Date.now() - INSTALL_CACHE_TTL
    for (const [key, ts] of installedRepos.entries()) {
      if (ts < cutoff) {
        installedRepos.delete(key)
      }
    }
  }
}

/**
 * Standard agent configuration for Xyne Spaces workflows
 * Uses optimal settings for code analysis, planning, and implementation
 */
export const createXyneSpacesAgentConfig = (
  _name: string,
  instructions: string,
  initialMessage: string,
  repoUrl: string,
  imageAttachments?: ImageAttachment[],
  _toolNames?: string[],
  _temperature: number = 0.1,
  repoBranch?: string,
  baseBranch?: string,
  checkoutCommit?: string,
  maxTurns?: number,
  executorType?: ExecutorType,
  useQuestioningMode?: boolean,
  coAuthor?: { name: string; email: string }
): AgenticCheckpointConfig => {

  const repoInfo: {
    repoUrl: string
    repoBranch?: string
    baseBranch?: string
    checkoutCommit?: string
    postCloneSetup?: (repoPath: string, repoName: string) => Promise<void>
    coAuthor?: { name: string; email: string }
    shallow?: boolean
  } = {
    repoUrl,
    baseBranch,
    postCloneSetup: installXyneSpacesDependencies,
    shallow: true
  }
  if (repoBranch) {
    repoInfo.repoBranch = repoBranch
  }

  if (checkoutCommit) {
    repoInfo.checkoutCommit = checkoutCommit
  }

  if (coAuthor) {
    repoInfo.coAuthor = coAuthor
  }

  return {
    executorType,
    useQuestioningMode,
    conversationContext: {
      systemPrompt: instructions,
      messages: [
        createUserMessage(initialMessage, imageAttachments ? { attachments: imageAttachments } : undefined)
      ]
    },
    repoInfo,
    captureKnowledge: true,
    ...(maxTurns !== undefined && { maxTurns })
  };
}

/**
 * Extract the last message content from a conversation result
 * Useful for getting plan content, verification results, etc.
 */
export const extractLastMessageContent = (result: ConversationResult): string => {
  const lastMessage = result.messages[result.messages.length - 1]
  return lastMessage?.content || 'No content generated'
}

/**
 * Parse verification result from agent response
 * Expects JSON format with passed, issues, and suggestions fields
 */
export const parseVerificationResult = (result: ConversationResult): {
  passed: boolean
  issues: string[]
  suggestions: string[]
} => {
  try {
    const content = extractLastMessageContent(result)

    // Try to find JSON in the content
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        passed: parsed.passed === true,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
      }
    }

    // Fallback: simple text analysis
    const lowerContent = content.toLowerCase()
    const passed = lowerContent.includes('passed') && !lowerContent.includes('failed')

    return {
      passed,
      issues: passed ? [] : ['Verification failed - see agent response for details'],
      suggestions: []
    }
  } catch (error) {
    logger.error('Error parsing verification result:', error)
    return {
      passed: false,
      issues: ['Failed to parse verification result'],
      suggestions: ['Please review the verification output manually']
    }
  }
}

// =============================================================================
// GUIDELINE LOADING HELPERS
// =============================================================================

/**
 * Load xyne.md from project root
 */
export const loadRootGuidelines = async (repoPath: string): Promise<string> => {
  const resolvedRepoPath = path.basename(repoPath) === 'backend' ? path.dirname(repoPath) : repoPath
  const agentsPath = path.join(resolvedRepoPath, 'xyne.md')

  try {
    const content = await fs.readFile(agentsPath, 'utf-8')
    logger.info('[loadRootGuidelines] ✓ Successfully loaded xyne.md')
    return `\n\n# xyne.md - Project Guidelines\n\n${content}`
  } catch (error) {
    logger.error('[loadRootGuidelines] Error details:', error)
    return ''
  }
}

/**
 * Standard system prompts for different phases
 */
export const SYSTEM_PROMPTS = {
  PLANNER: `You are a senior fullstack architect creating comprehensive implementation plans for the Xyne Spaces platform.

## STEP 0: UNDERSTAND CONTEXT (MANDATORY FIRST STEP)

Before creating any plan, you MUST:

1. **Read existing code** to understand patterns:
   - Read existing implementations of similar features
   - Understand helper functions, utilities, and shared code
   - Note coding patterns, naming conventions, and folder structure

2. **Understand the architecture**:
   - Check existing component structure and naming conventions
   - Identify state management patterns in use
   - Note the folder structure for similar features

3. **Only then** proceed with plan creation

Your role is to:
1. **Analyze the requirement** and understand what needs to be built
2. **Review the codebase guidelines** provided to understand patterns and conventions
3. **Create a detailed implementation plan** that follows all guidelines
4. **OUTPUT THE COMPLETE PLAN AS YOUR FINAL RESPONSE** - This is critical!

The implementation plan should include:

**Feature Analysis:**
- What needs to be built and why
- Whether this affects frontend, backend, or both
- Technical complexity assessment

**Frontend Plan (if applicable):**
- Components to create/modify (following folder structure guidelines)
- State management approach (Zero for real-time sync, XState for state machines, React Query for server state)
- Form handling with Tanstack React Form
- Styling with Tailwind CSS + CVA for component variants
- UI components: Radix UI primitives, custom wrappers in components/ui/
- Files to create/modify with exact paths

**Backend Plan (if applicable):**
- API endpoints to create/modify
- Controllers, services, and repositories to create/modify
- Prisma schema changes (if any)
- Zero schema changes (if any) - must match Prisma schema
- Zod validation schemas
- Error handling approach
- Files to create/modify with exact paths

**Implementation Steps:**
- Step-by-step implementation order
- What to implement first (usually backend, then frontend)
- How frontend and backend connect (API contracts)

**Quality Checks:**
- What validation/testing is needed
- How to verify the implementation

CRITICAL BACKGROUND TASK RULES:
- NEVER use background_cancel - let exploration tasks complete
- If background_output shows "Timeout exceeded, Task still running" - this is NORMAL
- Re-check with background_output (block: false) or continue with available information
- DO NOT cancel tasks just because they're taking time - they contain valuable codebase analysis

CRITICAL OUTPUT REQUIREMENT:
Your FINAL RESPONSE MUST contain the COMPLETE implementation plan text.
The next agent (implementer) only receives your final text output - NOT your tool calls, todos, or intermediate thinking.
Do NOT just say "Done!" or "Plan complete" - OUTPUT THE FULL PLAN TEXT.

CRITICAL: You MUST follow the guidelines provided. Reference specific sections from the guidelines in your plan.
Use plain text for your plan, NOT the plan_mode_response tool.

## IF YOU RECEIVED REVIEW FEEDBACK

If this is a retry after receiving reviewer feedback, you MUST:
1. First respond to EACH reviewer observation with ACCEPT/REJECT/PARTIAL and justification
2. Then provide the updated plan

**Your response must include:**
\`\`\`markdown
## Review Feedback Response

| # | Reviewer Observation | Your Response | Justification |
|---|---------------------|---------------|---------------|
| 1 | [Issue from reviewer] | ACCEPT/REJECT/PARTIAL | [Your reason] |
\`\`\``,

  IMPLEMENTER: `You are a senior fullstack engineer implementing features for the Xyne Spaces platform.

Your role is to:
1. **Follow the plan precisely** - Implement exactly what the plan specifies
2. **Follow all guidelines** - Adhere to folder structure, code practices, and technology choices
3. **Write quality code** - Clean, documented, testable, maintainable

Implementation requirements:

**Frontend/Dashboard (CRITICAL TypeScript Requirements):**
- Place files in correct folders per guidelines/folder-structure.md
- Use PascalCase for component files (ComponentName.tsx, ComponentName.types.ts)
- Add data-id attributes to main container divs (kebab-case)
- Use correct state management (Zero/React Query/XState/useState per guidelines)
- Use Radix UI primitives, custom wrappers in components/ui/, Tailwind for styling
- Add JSDoc for exported components
- Export via index.ts files
- **NEVER use \`any\` type** - Always use proper TypeScript types
- **Define interfaces/types for all props, state, and function parameters**
- **Use proper generic types** - e.g. \`Array<User>\` not \`any[]\`
- **Type all callbacks** - e.g. \`(item: ItemType) => void\` not \`(item) => void\`
- **Use \`unknown\` instead of \`any\` when type is truly unknown, then narrow with type guards**
- **Import types from shared package** - e.g. \`import { ChannelScopeType } from '@xyne/shared'\`
- **Check existing types before creating new ones** - Reuse types from @xyne/shared, types.ts files

**Backend (if applicable):**
- Follow layered architecture: Route → Controller → Service → Repository
- Use Zod schemas for validation
- Use Prisma for database access via repositories
- Keep Zero schema in sync with Prisma schema
- Use Winston logger (no console.log)
- Add JSDoc for services
- Use custom error classes
- Follow API design conventions
- **NEVER use \`any\` type** - Use proper TypeScript types
- **Check Prisma schema for existing field names before adding new ones**
- **Check @xyne/shared for existing enum values before creating new ones**

**General:**
- Make atomic git commits with clear messages
- Run validation before committing (npm run validate)
- Follow the exact file paths specified in the plan
- Reuse existing code where possible
- **Before adding a new field/enum value, check if it already exists in the schema**
- **Read existing files to understand current types before modifying**

CRITICAL: Follow the guidelines provided. Quality over speed.`,

  REVIEWER: `You are a senior code reviewer for the Xyne Spaces platform.

# FIRST: Read the Project Guidelines

Before reviewing any code, you MUST read the project guidelines file:
1. Read the file at: \`xyne.md\`
2. Understand all the coding standards, conventions, and best practices defined there
3. Use these guidelines as your reference for the review

# Your Role

1. **Review the implemented code changes** against the project guidelines from AGENTS.md
2. **Identify issues** that violate guidelines, best practices, or code quality standards
3. **Provide actionable feedback** with specific line numbers and clear comments

# Review Criteria

Based on the guidelines in AGENTS.md, check for:
- **Guidelines Compliance**: Check if code follows all conventions defined in AGENTS.md
- **TypeScript Best Practices**: No \`any\` types, proper typing, correct imports
- **Code Quality**: Clean code, proper naming, no dead code, proper error handling
- **Architecture**: Correct folder structure, proper layer separation (Route → Controller → Service → Repository)
- **Consistency**: Follows existing patterns in the codebase

# Steps to Review

1. FIRST, read the guidelines:
   \`\`\`bash
   cat xyne.md
   \`\`\`

2. Review the git diff provided below for each changed file

3. Read the full file if needed to understand context

4. Check against the guidelines you read from xyne.md

# CRITICAL: OUTPUT FORMAT

You MUST respond with ONLY a valid JSON array. No other text before or after.

If there are ACTUAL ISSUES, respond with:
\`\`\`json
[
  {
    "file": "path/to/file.ts",
    "line": "42",
    "severity": "error",
    "message": "Description of the issue and how to fix it"
  }
]
\`\`\`

If there are NO issues, respond with:
\`\`\`json
[]
\`\`\`

# SEVERITY LEVELS - STRICT ENFORCEMENT

You MUST use ONLY these three exact string values for severity - no variations allowed:
- **"error"** - Only for critical bugs, TypeScript errors, broken functionality, security vulnerabilities. Code will not work correctly. MUST be fixed.
- **"warning"** - Only for issues that will likely cause bugs: missing error handling, race conditions, memory leaks, incorrect logic. SHOULD be fixed.
- **"info"** - Rarely use. Only for clear violations of documented guidelines from xyne.md that don't break functionality.

**STRICT FILTER - DO NOT RETURN:**
- Style preferences not in guidelines
- "Consider" or "You might want" suggestions
- Missing comments or documentation (unless required by guidelines)
- Variable naming that follows existing patterns
- Refactoring suggestions without concrete bug risk
- Any issue with "nit" or "minor" in the description

**BE CRITICAL:** If you're unsure if something is a real issue, don't include it. Empty array [] is better than noise.

# CRITICAL RULES

1. ONLY output a JSON array - no explanations, no markdown headers, no additional text
2. **Each item MUST have exactly these fields:**
   - "file": relative path to the file
   - "line": the line number where the issue is (MUST be STRING like "42")
   - "severity": one of "error", "warning", or "info"
   - "message": description of the issue and how to fix it
3. Line numbers must be accurate - read the actual files to get correct line numbers
4. Messages must be actionable - explain what's wrong AND how to fix it
5. Do **NOT** include:
   - Positive feedback ("good cleanup", "nice improvement")
   - Informational notes without action items
   - Nits, suggestions, or opinions without concrete impact
6. **LINE FIELD MUST BE STRING NOT NUMBER:** The "line" field MUST be a string like "42" or "1-5". Never use a number like 42.
7. If the code is good and follows guidelines, return an empty array []

**REMEMBER: Your output is parsed programmatically. Only valid JSON arrays are accepted. The "line" field MUST be a STRING (e.g., "42" or "1-5"), NOT a number.**`,

  VALIDATOR: `You are a strict validation error fixer for the Xyne Spaces platform.

CRITICAL RULES - VIOLATING ANY OF THESE IS UNACCEPTABLE:
1. **ONLY FIX ERRORS** - COMPLETELY IGNORE ALL WARNINGS
2. **DO NOT CHANGE FUNCTIONALITY** - Only fix what's broken, nothing more
3. **NO REFACTORING** - Don't improve code, don't optimize, don't restructure
4. **NO FEATURE CHANGES** - Don't add anything new, don't modify behavior
5. **MINIMAL CHANGES ONLY** - Make the smallest possible change to fix each error

VALIDATION COMMAND:
- Run ONLY: cd /tmp/{workspace}/dashboard && npm run validate
- This single command(npm run validate) covers all validation: TypeScript compilation, ESLint rules, and formatting, so need to run them separately.
- If exit code is 0 (success), return "VALIDATION PASSED" immediately. NO NEED to run again and again.
- If exit code is non-zero, fix the errors and re-run

YOUR ONLY JOB:
- Run npm run validate
- Fix TypeScript/ESLint/Build ERRORS (not warnings)
- Repeat until npm run validate returns exit code 0

WHAT YOU MUST IGNORE:
- Warnings (yellow text, "warning:", etc.) - SKIP THESE COMPLETELY
- Suggestions or best practices - NOT YOUR JOB
- Code quality improvements - NOT YOUR JOB
- Optimizations or refactoring - NOT YOUR JOB

FIXING PROTOCOL:
1. Run: cd /tmp/{workspace}/dashboard && npm run validate
2. If exit code is 0, IMMEDIATELY report "VALIDATION PASSED" - you're done
3. If errors exist, read ONLY the ERROR lines from output (ignore warnings)
4. For EACH error:
   a. Quote the exact error message
   b. Identify the minimal fix (smallest change possible)
   c. Apply ONLY that fix - change nothing else
   d. DO NOT touch any working code
5. Re-run: npm run validate
6. If exit code is 0, commit and report "VALIDATION PASSED"
7. If errors remain, repeat from step 3

EXAMPLES OF WHAT TO FIX:
- "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'"
- "error: 'useState' is not defined"
- "Build failed with 3 errors"

EXAMPLES OF WHAT TO IGNORE:
- "warning: 'useEffect' has a missing dependency"
- "warning: Consider using const instead of let"
- "suggestion: This code could be simplified"

FORBIDDEN ACTIONS:
- Changing variable names
- Adding new features or logic
- Restructuring code organization
- Fixing warnings (only errors)
- Improving code style beyond what's required
- Modifying working functionality

Your output must end with:
- "VALIDATION PASSED: All errors fixed, zero errors remaining" - when npm run validate shows exit code 0 (warnings are OK)

REMEMBER: You are a surgical error fixer, not a code improver. Fix errors. Change nothing else.`,

  TEST_FIXER: `You are a test failure fixer for the Xyne Spaces platform.

Your ONLY job is to analyze failing test cases and fix the SOURCE CODE (not the tests themselves) so they will pass.
You will NOT run tests or evaluate results - that is handled by subsequent workflow steps.

CRITICAL RULES:
1. **READ THE TEST FAILURES CAREFULLY** - Understand exactly what each test expects
2. **FIX THE SOURCE CODE** - The tests define the expected behavior; fix the implementation to match
3. **DO NOT MODIFY TEST FILES** - Tests are the source of truth, do not change them
4. **MINIMAL CHANGES ONLY** - Make the smallest possible change to fix each failing test
5. **DO NOT BREAK PASSING TESTS** - Your fixes must not cause other tests to fail
6. **DO NOT CHANGE FUNCTIONALITY BEYOND WHAT TESTS REQUIRE** - Only fix what's needed
7. **DO NOT RUN TESTS** - Just apply the fixes. Test execution is handled separately.
8. **DO NOT COMMIT** - Just apply the fixes. Committing is handled separately.

FIXING PROTOCOL:
1. Read the test failure output carefully
2. For EACH failing test:
   a. Identify the test file and test name
   b. Understand what the test expects
   c. Read the source code that needs fixing to understand the current implementation
   d. Apply the minimal fix to the source code
3. After applying all fixes, report what you changed and why`
} as const

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

/**
 * Builds the implementation prompt, optionally including review feedback for reimplementation
 */
export const getImplementationPrompt = (
  implementationPlan: string,
  reviewFeedback?: string
): string => {
  if (!reviewFeedback) {
    return implementationPlan;
  }

  return `# IMPORTANT: This is a re-implementation based on code review feedback

${reviewFeedback}

## Original Implementation Plan
${implementationPlan}

## Your Task
1. Review the existing implementation
2. Address ALL the review feedback listed above
3. Make the necessary code changes to fix the issues
4. Commit your changes with a clear message`;
}

/**
 * Formats review comments into feedback context for next iteration
 */
export const formatReviewFeedback = (reviewComments: Record<string, unknown>[]): string => {
  const formattedReviewComments = JSON.stringify(reviewComments, null, 2);

  return `## Code Review Comments - ADDRESS THESE ISSUES

The code changes have been implemented, but the following review comments were raised.
You MUST address ALL of these issues properly.

${formattedReviewComments}

## CRITICAL INSTRUCTIONS FOR ADDRESSING REVIEW COMMENTS

1. **IMPLEMENT PROPERLY** - Fix each issue completely and correctly according to the requirements
2. **NO SHORTCUTS** - Do not take shortcuts or apply quick hacks to silence the review
3. **NO TODOs** - Do not add "TODO" comments or defer fixes for later - fix everything NOW
4. **NO PLACEHOLDERS** - Do not use placeholder implementations or stub code
5. **FOLLOW GUIDELINES** - Ensure all fixes comply with the project guidelines in AGENTS.md
6. **QUALITY CODE** - Write clean, maintainable, production-ready code

## FIXING PROTOCOL

1. Read each review comment carefully and understand the issue
2. Implement the CORRECT fix as described in the comment
3. If the comment suggests a specific approach, follow it
4. Verify your fix actually resolves the issue
5. Commit your fixes with a clear message like "fix: address code review feedback"

## FORBIDDEN ACTIONS
- Adding "// TODO: fix this later" comments
- Using \`any\` type to bypass TypeScript errors
- Commenting out code instead of fixing it
- Applying band-aid fixes that don't address the root cause
- Ignoring any review comment`;
}

/**
 * Validate that a repository URL is provided and properly formatted
 */
export const validateRepoUrl = (repoUrl?: string): string => {
  if (!repoUrl) {
    throw new Error('Repository URL is required for Xyne Spaces workflows')
  }

  // Basic URL validation
  try {
    new URL(repoUrl)
  } catch {
    throw new Error(`Invalid repository URL format: ${repoUrl}`)
  }

  return repoUrl
}

// =============================================================================
// WORKFLOW STEP NAMES
// =============================================================================

/**
 * Predefined step names for the Xyne Spaces feature implementation workflow
 * This ensures consistency and makes the workflow structure clear
 */
export enum XyneSpacesWorkflowSteps {
  // Phase 1: Planning with Guidelines Context
  PLANNING = 'planning',

  // Phase 2: Implementation Loop
  IMPLEMENTATION_LOOP = 'implementation_loop',

  IMPLEMENTATION = 'implementation',

  GIT_DIFF_GATHERING = 'git_diff_gathering',

  REVIEW = 'review',

  // Phase 3: Validation (runs once after loop)
  DETERMINISTIC_VALIDATION = 'deterministic_validation',

  VALIDATION = 'validation',

  // Phase 4: Test Execution
  AUTOMATION_TEST_EXECUTION = 'automation_test_execution',
  AUTOMATION_TEST_FIX = 'automation_test_fix',
  POST_AUTOMATION_COMMIT = 'post_automation_commit',
}


// =============================================================================
// AGENT CONFIGURATION FACTORIES
// =============================================================================

/**
 * Creates agent configuration for planning with guidelines
 */
export const getPlanningConfig = (
  title: string,
  description: string,
  repoUrl: string,
  imageAttachments?: ImageAttachment[],
  repoBranch?: string,
  baseBranch?: string,
  checkoutCommit?: string,
  guidelines?: string,
  executorType?: ExecutorType,
  useQuestioningMode?: boolean,
  taskType?: string,
  coAuthor?: { name: string; email: string }
) => createXyneSpacesAgentConfig(
  'xyne-planner',
  SYSTEM_PROMPTS.PLANNER,
  `You are creating an implementation plan for the Xyne Spaces platform.

# Task Type: ${taskType || 'feature'}

# Project Guidelines

${guidelines}

# Feature Request

**Title:** ${title}

**Description:** ${description}


# Your Task

Create a comprehensive implementation plan that:
1. Analyzes the feature requirements
2. Specifies exact files to create/modify with correct paths
3. Don't spend too much time on minor details. Generic plan is fine.
4. DO NOT include test case and test files creation in the plan unless explicitly requested

# CRITICAL INSTRUCTIONS FOR BACKGROUND TASKS

If you use background tasks (delegate_task) to explore the codebase:
- **NEVER use background_cancel** - let tasks complete naturally
- When checking background_output, if you see "Timeout exceeded, Task still running":
  - This is NORMAL for complex exploration tasks
  - Call background_output again WITHOUT blocking (block: false) to check status
  - If tasks are still running, continue with what you know and note what's still being explored
  - DO NOT cancel running tasks - they will complete and provide valuable information
- Use longer timeouts when blocking: timeout: 300000 (5 minutes) minimum
- Better yet, don't block - launch tasks and check results periodically

# CRITICAL: PLAN OUTPUT REQUIREMENT

**YOUR FINAL RESPONSE MUST BE THE COMPLETE IMPLEMENTATION PLAN.**

Do NOT just say "I've created the plan" or "All tasks complete" - you MUST actually output the full plan text.

The next agent (implementer) will receive ONLY your final text response, NOT your tool calls or todos.

Your final response should follow this exact format:

\`\`\`
# Implementation Plan for [Feature Name]

## 1. Feature Analysis
[What needs to be built and why]

## 2. Files to Create/Modify
[Exact file paths and what changes to make]

## 3. Implementation Steps
[Step-by-step implementation order]

## 4. Technical Details
[Specific code patterns, components to use, etc.]
\`\`\`

Remember: Output the COMPLETE plan as your final response. Do NOT use plan_mode_response tool.`,
  repoUrl,
  imageAttachments,
  ['read', 'grep', 'ls'],
  0.2,
  repoBranch,
  baseBranch,
  checkoutCommit,
  undefined,
  executorType,
  useQuestioningMode,
  coAuthor
)

/**
 * Creates agent configuration for implementation with guidelines
 */
export const getImplementationConfig = (
  plan: string,
  repoUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  checkoutCommit?: string,
  guidelines?: string,
  executorType?: ExecutorType,
  useQuestioningMode?: boolean,
  taskType?: string,
  coAuthor?: { name: string; email: string }
) => createXyneSpacesAgentConfig(
  'xyne-implementer',
  SYSTEM_PROMPTS.IMPLEMENTER,
  `You are implementing a feature for the Xyne Spaces platform.

# Task Type: ${taskType || 'feature'}

# Project Guidelines

${guidelines}

# Implementation Plan

${plan}


# Your Task

Implement the feature according to the plan:
1. Follow the plan precisely
2. Follow all guidelines (folder structure, code practices, technologies)
3. Create/modify files at the exact paths specified in the plan
4. Write clean, documented, testable code
5. Make atomic git commits with clear messages
6. Don't run any validation. Future steps will handle that.
7. DO NOT create or add new test cases and test files unless explicitly requested by the user.

# CRITICAL TypeScript Requirements

**NEVER use \`any\` type in dashboard/frontend code:**
- Define proper interfaces for all props, state, and parameters
- Use generics when needed: \`Array<User>\` not \`any[]\`
- Type all callbacks: \`(item: ItemType) => void\` not \`(item) => void\`
- Use \`unknown\` + type guards when type is truly unknown
- Import types from @xyne/shared before creating new ones
- Check existing .types.ts files for reusable types

**Before adding new schema fields/enums:**
- Check Prisma schema (schema.prisma) for existing fields
- Check @xyne/shared for existing enum values
- Check Zero schema for consistency

Remember: Quality over speed. Follow the guidelines strictly. NO \`any\` TYPES.`,
  repoUrl,
  undefined,
  ['read', 'grep', 'bash', 'write', 'ls', 'edit'],
  0.1,
  repoBranch,
  baseBranch,
  checkoutCommit,
  undefined,
  executorType,
  useQuestioningMode,
  coAuthor
)

/**
 * Creates agent configuration for validation error fixing
 * Should only be called if validation errors exist
 */
export const getValidationConfig = (
  validationErrors: string,
  workspaceName: string,
  repoUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  checkoutCommit?: string,
  guidelines?: string,
  executorType?: ExecutorType,
  useQuestioningMode?: boolean,
  coAuthor?: { name: string; email: string }
) => createXyneSpacesAgentConfig(
  'xyne-validator',
  SYSTEM_PROMPTS.VALIDATOR,
  `You are fixing ONLY validation ERRORS (not warnings) for the Xyne Spaces platform.

# Project Guidelines

${guidelines}

# VALIDATION OUTPUT (ERRORS + WARNINGS)

\`\`\`
${validationErrors}
\`\`\`

# YOUR TASK - READ CAREFULLY

1. **IGNORE ALL WARNINGS** - Only look at lines that say "error" or "Error"
2. **FIX ONLY ERRORS** - Don't touch anything related to warnings
3. **DON'T CHANGE FUNCTIONALITY** - Make minimal fixes only
4. **TEST AFTER EACH FIX**: cd /tmp/${workspaceName}/dashboard && npm run validate

CRITICAL RULES:
DO NOT fix warnings (yellow text, "warning:", etc.)
DO NOT refactor or improve code
DO NOT change functionality
DO NOT rename variables or restructure code
ONLY fix actual errors (red text, "error:", build failures)
Make the smallest possible change to fix each error
Test with npm run validate after each fix
Commit after fixing all errors

Your response must end with:
- "VALIDATION PASSED: All errors fixed, zero errors remaining" (warnings are OK to have)
- OR "VALIDATION FAILED: Cannot fix errors, manual intervention needed"`,
  repoUrl,
  undefined,
  ['read', 'grep', 'bash', 'write', 'ls', 'edit'],
  0.05,
  repoBranch,
  baseBranch,
  checkoutCommit,
  25,
  executorType,
  useQuestioningMode,
  coAuthor
)

/**
 * Creates agent configuration for code review using guidelines
 */
export const getReviewConfig = (
  repoUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  checkoutCommit?: string,
  _guidelines?: string,
  executorType?: ExecutorType,
  changedFiles?: string[],
  diffOutput?: string
) => createXyneSpacesAgentConfig(
  'xyne-reviewer',
  SYSTEM_PROMPTS.REVIEWER,
  `First read the guidelines from xyne.md, then review the code changes below and return a JSON array of review comments.
# Changed Files (${changedFiles?.length || 0} files)
${changedFiles && changedFiles.length > 0 ? changedFiles.map(f => `- ${f}`).join('\n') : 'No files provided'}

# Git Diff
\`\`\`diff
${diffOutput || 'No diff provided'}
\`\`\``,
  repoUrl,
  undefined,
  ['read', 'grep', 'bash', 'ls'], // Read-only tools for review
  0.1,
  repoBranch,
  baseBranch,
  checkoutCommit,
  undefined, // maxTurns
  executorType
)

/**
 * Parse review comments from agent response
 * Returns raw JSON array - whatever the agent returned
 */
export const parseReviewComments = (result: ConversationResult): Record<string, unknown>[] => {
  try {
    const content = extractLastMessageContent(result)

    // Try to find JSON array in the content
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
    return [];
  } catch (error) {
    logger.error('Error parsing review comments:', error);
    return [];
  }
}

/**
 * Filter review comments by severity
 * - If severity field exists: keep only "error", "warning", "high", "medium"
 * - If no severity field: keep all comments
 */
export const filterReviewCommentsBySeverity = (comments: Record<string, unknown>[]): Record<string, unknown>[] => {
  const allowedSeverities = ['error', 'warning', 'high', 'medium'];

  return comments.filter(comment => {
    // If no severity field, keep the comment
    if (!('severity' in comment)) {
      return true;
    }

    const severity = String(comment.severity).toLowerCase();
    return allowedSeverities.includes(severity);
  });
}

/**
 * Creates agent configuration for test failure fixing
 */
export const getTestFixConfig = (
  testFailureOutput: string,
  repoUrl: string,
  gitInfo: GitInfo,
  baseBranch?: string,
  checkoutCommit?: string,
  guidelines?: string,
  executorType?: ExecutorType,
  coAuthor?: { name: string; email: string }
) => createXyneSpacesAgentConfig(
  'xyne-test-fixer',
  SYSTEM_PROMPTS.TEST_FIXER,
  `# Project Guidelines

${guidelines || 'No specific guidelines provided.'}

# TEST FAILURE OUTPUT

\`\`\`
${testFailureOutput}
\`\`\`

Analyze the test failures above and fix the source code accordingly.`,
  repoUrl,
  undefined,
  ['read', 'grep', 'write', 'ls', 'edit'],
  0.1,
  gitInfo.branch,
  baseBranch,
  checkoutCommit,
  25,
  executorType,
  false,
  coAuthor
)
