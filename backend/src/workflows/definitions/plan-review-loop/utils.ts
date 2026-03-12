/**
 * Plan Review Loop Workflow Utilities
 *
 * Contains utilities specific to the plan-review-loop workflow:
 * - Review step enums, types, and interfaces
 * - Review agent configuration factories
 * - Review result parsing and feedback formatting
 * - Plan file management
 */

import { type ConversationResult } from '@framework'
import { ExecutorType } from '../../workflow-types'
import { ImageAttachment } from '../../types/workflow-enums'
import * as fs from 'fs/promises'
import { access, } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/utils/logger'
import {
  createXyneSpacesAgentConfig,
  extractLastMessageContent,
} from '../xyne-spaces-workflows/utils'
import { getAgentConfig } from '../../config'

import { QUALITY_GATES, type TaskType } from './constants';
export { QUALITY_GATES, type TaskType } from './constants';

// =============================================================================
// WORKFLOW STEP NAMES
// =============================================================================

/**
 * Step names for the Xyne Spaces Plan Review Loop workflow
 * Includes review steps for both planning and implementation phases
 */
export enum XyneSpacesPlanReviewLoopSteps {
  // Loop 1: Planning with Review
  PLANNING = 'planning',
  PLAN_REVIEW = 'plan_review',

  // Loop 2: Implementation with Review
  IMPLEMENTATION = 'implementation',
  IMPLEMENTATION_REVIEW = 'implementation_review',

  // Validation
  VALIDATION = 'validation',
}

// =============================================================================
// REVIEW TYPES
// =============================================================================

/**
 * Result from a review agent (Plan Review or Implementation Review)
 */
export interface ReviewResult {
  score: number;           // 1-10 (validated, default 0 if invalid)
  approved: boolean;       // score > threshold
  feedback: string;        // Detailed feedback
  issues: string[];        // List of issues found
  suggestions: string[];   // Improvement suggestions
}

/**
 * Review metrics for analytics and tracking
 */
export interface ReviewMetrics {
  planReview: {
    score: number;
    feedback: string;
    iterations: number;
    approvedAt: string;  // ISO timestamp
  };
  implementationReview: {
    score: number;
    feedback: string;
    iterations: number;
    approvedAt: string;
  };
}

// =============================================================================
// REVIEW SYSTEM PROMPTS - sourced from config.ts (single source of truth)
// =============================================================================

const REVIEW_SYSTEM_PROMPTS = {
  get PLAN_REVIEWER() {
    return getAgentConfig('xyne-plan-reviewer')?.systemPrompt ?? ''
  },
  get IMPLEMENTATION_REVIEWER() {
    return getAgentConfig('xyne-implementation-reviewer')?.systemPrompt ?? ''
  },
} as const

// =============================================================================
// QUALITY GATE HELPERS
// =============================================================================

/**
 * Get applicable quality gates based on task type
 */
export const getQualityGatesForTaskType = (taskType?: TaskType): string => {
  if (!taskType || taskType === 'feature') {
    return QUALITY_GATES;
  }

  if (taskType === 'bug' || taskType === 'security') {
    return QUALITY_GATES + `

### 10. RCA (Root Cause Analysis)
- Steps to reproduce the issue
- Root cause analysis
- Fix applied and why`;
  }

  return QUALITY_GATES;
};

// =============================================================================
// REVIEW HELPER FUNCTIONS
// =============================================================================

/**
 * Validate score is within 1-10 range.
 * Returns 0 if invalid (triggers failure).
 */
const validateScore = (score: unknown): number => {
  if (typeof score !== 'number' || isNaN(score)) {
    return 0;
  }
  const rounded = Math.round(score);
  if (rounded < 1 || rounded > 10) {
    return 0;
  }
  return rounded;
};

/**
 * Parse review result from agent response.
 * Validates score is 1-10, defaults to 0 if invalid.
 */
export const parseReviewResult = (result: ConversationResult): ReviewResult => {
  try {
    const content = extractLastMessageContent(result);

    // Try to find JSON in code block first
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      const score = validateScore(parsed.score);
      return {
        score,
        approved: parsed.approved ?? score > 7,
        feedback: parsed.feedback || '',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    }

    // Fallback: try to find any JSON object
    const anyJsonMatch = content.match(/\{[\s\S]*\}/);
    if (anyJsonMatch) {
      const parsed = JSON.parse(anyJsonMatch[0]);
      const score = validateScore(parsed.score);
      return {
        score,
        approved: parsed.approved ?? score > 7,
        feedback: parsed.feedback || '',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    }

    // Failed to parse
    return {
      score: 0,
      approved: false,
      feedback: 'Failed to parse review result - invalid JSON format',
      issues: ['Invalid response format from reviewer'],
      suggestions: [],
    };
  } catch (error) {
    logger.error('Error parsing review result:', error);
    return {
      score: 0,
      approved: false,
      feedback: 'Error parsing review result',
      issues: ['Parse error: ' + (error instanceof Error ? error.message : 'Unknown error')],
      suggestions: [],
    };
  }
};

/**
 * Check if a file exists
 */
export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Save implementation plan to file in the cloned repository.
 * Location: .xyne/plans/{ticketId}-{sanitized-title}.md
 * If file exists, creates v1, v2, etc. versions.
 */
export const savePlanToFile = async (
  plan: string,
  ticketId: string,
  ticketTitle: string,
  repoPath: string
): Promise<string> => {
  const planDir = join(repoPath, '.xyne', 'plans');
  await fs.mkdir(planDir, { recursive: true });

  // Sanitize title for filename
  const sanitizedTitle = ticketTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  let baseName = `${ticketId}-${sanitizedTitle}`;
  let planPath = join(planDir, `${baseName}.md`);

  // Check for existing and add version suffix
  let version = 1;
  while (await fileExists(planPath)) {
    planPath = join(planDir, `${baseName}-v${version}.md`);
    version++;
  }

  await fs.writeFile(planPath, plan, 'utf-8');
  logger.info(`Plan saved to: ${planPath}`);
  return planPath;
};

/**
 * Format feedback for next iteration.
 * Uses structured numbered list format.
 */
export const formatFeedbackForRetry = (
  score: number,
  _issues: string[],
  feedback: string,
  previousPlan?: string,
  originalDescription?: string
): string => {
  // When previousPlan and originalDescription are provided (planning phase),
  // give the agent full revision context. Otherwise (implementation phase),
  // just provide the reviewer feedback.
  if (previousPlan && originalDescription) {
    return `# ⚠️ THIS IS A REVISION TASK — DO NOT START FROM SCRATCH

## 1. ORIGINAL TASK (what the user asked for)

${originalDescription}

## 2. YOUR PREVIOUS PLAN (what you produced last time)

${previousPlan}

## 3. REVIEWER FEEDBACK (score: ${score}/10)

${feedback}

## 4. YOUR INSTRUCTIONS

You MUST:
1. First, respond to EACH reviewer observation in this table format:

| # | Reviewer Observation | Your Response | Justification |
|---|---------------------|---------------|---------------|
| 1 | [Issue from reviewer] | ACCEPT/REJECT/PARTIAL | [Your reason] |

- ACCEPT: You will fix this in your revised plan
- REJECT: Explain why this is not a valid issue
- PARTIAL: Explain what you'll fix and what you disagree with

2. Then output the REVISED plan with accepted changes applied.

Do NOT start from scratch. Iterate on your previous plan.`;
  }

  // Implementation phase: simpler feedback (code persists on branch)
  return `Previous score: ${score}/10

## Reviewer feedback:

${feedback}

Respond to each issue (ACCEPT/REJECT/PARTIAL) then fix the accepted issues.`;
};

// =============================================================================
// REVIEW AGENT CONFIGURATION FACTORIES
// =============================================================================

/**
 * Creates agent configuration for Plan Review step.
 */
export const getPlanReviewConfig = (
  title: string,
  description: string,
  imageAttachments: ImageAttachment[] | undefined,
  plan: string,
  repoUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  executorType?: ExecutorType,
  taskType?: TaskType,
  coAuthor?: { name: string; email: string },
  previousReviewFeedback?: string
) => createXyneSpacesAgentConfig(
  'xyne-plan-reviewer',
  REVIEW_SYSTEM_PROMPTS.PLAN_REVIEWER,
  `Review the following implementation plan against the requirements.

# Task Type: ${taskType || 'feature'}
(Determines which quality gates are applicable)

# ORIGINAL REQUIREMENT

**Title:** ${title}

**Description:** ${description}

${imageAttachments?.length ? `**Attachments:** ${imageAttachments.length} image(s) attached` : ''}
${previousReviewFeedback ? `
# YOUR PREVIOUS REVIEW FEEDBACK

You previously reviewed an earlier version of this plan and gave this feedback:

${previousReviewFeedback}

The planner has responded with justifications (ACCEPT/REJECT/PARTIAL) in their revised plan below.
Verify whether accepted issues were actually fixed and whether rejected justifications are valid.
` : ''}
# PROPOSED PLAN

${plan}

# YOUR TASK

Score this plan (1-10) against the requirements and provide detailed feedback in **markdown format**.
Remember: You are ADVERSARIAL. Challenge any gaps or weaknesses.

# QUALITY GATES FOR THIS TASK TYPE

${getQualityGatesForTaskType(taskType)}

## MANDATORY: PLAN SCOPE CHECK

You MUST verify the plan only includes what's needed for the requirement:

**Steps:**
1. Compare plan's "Files to Create/Modify" against the original requirement
2. Check if any planned features are NOT in the original requirement
3. Flag any unnecessary features as "Plan Scope Creep"

**Scoring Impact:**
- Plan matches requirement exactly → no penalty
- Plan has extra features without justification → reduce score by 2 points
- Major scope creep → automatic score of 5 or below

Your response MUST include:
1. A markdown report with sections for Score, Summary, Requirements Coverage, Plan Scope Check, Issues, and Suggestions
2. A JSON code block at the end with the structured data for programmatic parsing

Follow the exact output format specified in your system instructions.`,
  repoUrl,
  undefined,  // imageAttachments
  ['read', 'grep'],
  0.1,
  repoBranch,
  baseBranch,
  undefined,  // checkoutCommit
  undefined,  // maxTurns
  executorType,
  false,      // useQuestioningMode
  coAuthor
);

/**
 * Creates agent configuration for Implementation Review step.
 */
export const getImplementationReviewConfig = (
  plan: string,
  changedFiles: string[],
  gitDiff: string,
  repoUrl: string,
  repoBranch?: string,
  baseBranch?: string,
  executorType?: ExecutorType,
  taskType?: TaskType,
  coAuthor?: { name: string; email: string },
  previousReviewFeedback?: string,
  earlyValidationErrors?: string
) => createXyneSpacesAgentConfig(
  'xyne-implementation-reviewer',
  REVIEW_SYSTEM_PROMPTS.IMPLEMENTATION_REVIEWER,
  `Review the following implementation against the plan.

# Task Type: ${taskType || 'feature'}
(Determines which quality gates are applicable)

# IMPLEMENTATION PLAN

${plan}
${previousReviewFeedback ? `
# YOUR PREVIOUS REVIEW FEEDBACK

You previously reviewed an earlier version of this implementation and gave this feedback:

${previousReviewFeedback}

The implementer has responded with justifications (ACCEPT/REJECT/PARTIAL) and made changes.
Verify whether accepted issues were actually fixed and whether rejected justifications are valid.
` : ''}${earlyValidationErrors ? `
# ⚠️ EARLY VALIDATION ERRORS

The following TypeScript/ESLint errors were detected during early validation:

${earlyValidationErrors}

**Important:** These errors must be fixed, but you should ALSO provide architectural feedback on the implementation. Score appropriately considering both the validation errors AND the code quality.
` : ''}
# CHANGED FILES

${changedFiles.length > 0 ? changedFiles.map(f => `- ${f}`).join('\n') : 'No files changed'}

# GIT DIFF

\`\`\`diff
${gitDiff || 'No changes'}
\`\`\`

# YOUR TASK

1. Use the \`read\` tool to examine specific files if needed
2. Score this implementation (1-10) against the plan
3. Provide detailed feedback in **markdown format**

## 🚨 MANDATORY: SCOPE CREEP CHECK

You MUST check if the implementation contains anything NOT in the plan:

**Steps:**
1. Compare git diff against the plan's "Files to Create/Modify" section
2. For each changed file, verify it's in the plan
3. Identify ANY code changes not covered by the plan

**For each extra item found:**
- List it as "Scope Creep" in Issues
- If implementer provided justification ("Extra feature: [reason]") → evaluate if justification is valid
- If NO justification → mark as FAILED, require removal or justification

**Scoring Impact:**
- Valid justification provided → don't penalize
- No justification → reduce score by 2 points
- Major scope creep (multiple features) → automatic score of 5 or below

**Report format:**
\`\`\`markdown
## Scope Creep Analysis
- [ ] No scope creep detected
- [ ] Scope creep detected (see below)

### Extra Changes Found
| Change | In Plan? | Justification | Status |
|--------|----------|---------------|--------|
| [file:change] | No | None | REJECT |
| [file:change] | No | "Extra feature: [reason]" | REVIEW |
\`\`\`

Remember: You are ADVERSARIAL. Challenge any deviations or quality issues.

# QUALITY GATES FOR THIS TASK TYPE

${getQualityGatesForTaskType(taskType)}

Your response MUST include:
1. A markdown report with sections for Score, Summary, Plan Adherence, Code Quality, Scope Creep Analysis, Issues, and Suggestions
2. A JSON code block at the end with the structured data for programmatic parsing

Follow the exact output format specified in your system instructions.`,
  repoUrl,
  undefined,  // imageAttachments
  ['read', 'grep'],
  0.1,
  repoBranch,
  baseBranch,
  undefined,  // checkoutCommit
  undefined,  // maxTurns
  executorType,
  false,      // useQuestioningMode
  coAuthor
);
