/**
 * Xyne Spaces Workflow Utilities
 *
 * This module contains shared utilities and configurations for Xyne Spaces specific workflows.
 * It provides helper functions for creating agent configurations, parsing results, and
 * managing workflow state across different phases of feature implementation.
 */

import { createUserMessage, type ConversationResult } from '@framework'
import { AgenticCheckpointConfig } from '../../workflow-types'
import { ImageAttachment } from '../../types/workflow-enums'
import * as fs from 'fs/promises'
import * as path from 'path'
import {logger} from '@/utils/logger';

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
  checkoutCommit?: string
): AgenticCheckpointConfig => {

  const repoInfo: { repoUrl: string; repoBranch?: string; baseBranch?: string; checkoutCommit?: string } = { repoUrl, baseBranch }
  if (repoBranch) {
    repoInfo.repoBranch = repoBranch
  }  
  
  if (checkoutCommit) {
    repoInfo.checkoutCommit = checkoutCommit
  }  

  return {
    conversationContext: {
      systemPrompt: instructions,
      messages: [
        createUserMessage(initialMessage, imageAttachments ? { attachments: imageAttachments } : undefined)
      ]
    },
    repoInfo,
    captureKnowledge: true  // Enable knowledge capture by default for all Xyne Spaces workflows
  }
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
 * Load AGENTS.md from project root
 */
export const loadRootGuidelines = async (repoPath: string): Promise<string> => {
  const resolvedRepoPath = path.basename(repoPath) === 'backend' ? path.dirname(repoPath) : repoPath
  const agentsPath = path.join(resolvedRepoPath, 'guidelines', 'AGENTS.md')
  
  try {
    const content = await fs.readFile(agentsPath, 'utf-8')
    console.log('[loadRootGuidelines] ✓ Successfully loaded AGENTS.md')
    return `\n\n# AGENTS.md - Project Guidelines\n\n${content}`
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

Your role is to:
1. **Analyze the requirement** and understand what needs to be built
2. **Review the codebase guidelines** provided to understand patterns and conventions
3. **Create a detailed implementation plan** that follows all guidelines

The implementation plan should include:

**Feature Analysis:**
- What needs to be built and why
- Whether this affects frontend, backend, or both
- Technical complexity assessment

**Frontend Plan (if applicable):**
- Components to create/modify (following folder structure guidelines)
- State management approach (Zero, React Query, XState, or useState)
- UI components from Juspay Blend to use
- Form handling with Tanstack Form + Zod
- Styling with Tailwind CSS
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

CRITICAL: You MUST follow the guidelines provided. Reference specific sections from the guidelines in your plan.
Use plain text for your plan, NOT the plan_mode_response tool.`,

  IMPLEMENTER: `You are a senior fullstack engineer implementing features for the Xyne Spaces platform.

Your role is to:
1. **Follow the plan precisely** - Implement exactly what the plan specifies
2. **Follow all guidelines** - Adhere to folder structure, code practices, and technology choices
3. **Write quality code** - Clean, documented, testable, maintainable

Implementation requirements:

**Frontend (if applicable):**
- Place files in correct folders per guidelines/folder-structure.md
- Use PascalCase for component files (ComponentName.tsx, ComponentName.types.ts)
- Add data-id attributes to main container divs (kebab-case)
- Use correct state management (Zero/React Query/XState/useState per guidelines)
- Use Juspay Blend components, Tailwind for styling
- Add JSDoc for exported components
- Export via index.ts files

**Backend (if applicable):**
- Follow layered architecture: Route → Controller → Service → Repository
- Use Zod schemas for validation
- Use Prisma for database access via repositories
- Keep Zero schema in sync with Prisma schema
- Use Winston logger (no console.log)
- Add JSDoc for services
- Use custom error classes
- Follow API design conventions

**General:**
- Make atomic git commits with clear messages
- Run validation before committing (npm run validate)
- Follow the exact file paths specified in the plan
- Reuse existing code where possible

CRITICAL: Follow the guidelines provided. Quality over speed.`
} as const

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

  // Phase 2: Implementation
  IMPLEMENTATION = 'implementation',
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
  guidelines?: string
) => createXyneSpacesAgentConfig(
  'xyne-planner',
  SYSTEM_PROMPTS.PLANNER,
  `You are creating an implementation plan for the Xyne Spaces platform.

# Project Guidelines

${guidelines}

# Feature Request

**Title:** ${title}

**Description:** ${description}


# Your Task

Create a comprehensive implementation plan that:
1. Analyzes the feature requirements
2. It will be a frontend change always
3. Specifies exact files to create/modify with correct paths
4. Don't spend too much time on minor details. Generic plan is fine.

Remember: Use plain text for your plan, NOT the plan_mode_response tool.`,
  repoUrl,
  imageAttachments,
  ['read', 'grep', 'ls'], // Read-only tools for planning
  0.2, // Lower temperature for structured planning
  repoBranch,
  baseBranch,
  checkoutCommit
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
  guidelines?: string
) => createXyneSpacesAgentConfig(
  'xyne-implementer',
  SYSTEM_PROMPTS.IMPLEMENTER,
  `You are implementing a feature for the Xyne Spaces platform.

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

Remember: Quality over speed. Follow the guidelines strictly.`,
  repoUrl,
  undefined, // No new image attachments needed for implementation phase
  ['read', 'grep', 'bash', 'write', 'ls', 'edit'], // Full tool access
  0.1, // Low temperature for precise implementation
  repoBranch,
  baseBranch,
  checkoutCommit
)
