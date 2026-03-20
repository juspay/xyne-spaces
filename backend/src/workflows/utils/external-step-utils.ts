/**
 * Question utilities for the ask-question flow.
 *
 * Handles:
 *  - Formatting questions as readable text for assistant messages
 *  - Creating activity records when questions are asked
 *  - Framework question group flattening
 */

import { repositories } from '@/database/repositories'
import { logger } from '@/utils/logger'
import { ActivityClassification } from '@prisma/client'
import { DatabaseClient } from '@/database/client'
import { activityService } from '@/services/activity/activityService'
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service'
import type { QuestionAskedEvent } from '../framework/opencode/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of a question group coming from the agentic framework's ask_question tool.
 */
export interface FrameworkQuestionGroup {
  heading?: string
  header?: string
  questions?: Array<{
    question: string
    type?: string
    options?: Array<{ id: string; label: string; description?: string }>
    custom?: boolean
  }>
}

// ---------------------------------------------------------------------------
// Question text formatting (for rendering questions as assistant messages)
// ---------------------------------------------------------------------------

/**
 * Format OpenCode-style questions as readable text for display as an assistant message.
 */
export function formatQuestionsAsText(
  questions: QuestionAskedEvent['properties']['questions']
): string {
  const parts: string[] = []
  parts.push('I have some questions before proceeding:\n')

  questions.forEach((q, idx) => {
    parts.push(`**${idx + 1}. ${q.question}**`)
    if (q.header && q.header !== q.question) {
      parts.push(`   ${q.header}`)
    }
    if (q.options && q.options.length > 0) {
      q.options.forEach((opt) => {
        const desc = opt.description ? ` — ${opt.description}` : ''
        parts.push(`   - ${opt.label}${desc}`)
      })
      if (q.multiple) {
        parts.push(`   *(Select multiple)*`)
      }
    }
    parts.push('')
  })

  return parts.join('\n').trim()
}

/**
 * Flatten framework QuestionGroup[] into the format expected by formatQuestionsAsText.
 */
function flattenFrameworkQuestionGroups(
  groups: FrameworkQuestionGroup[]
): QuestionAskedEvent['properties']['questions'] {
  return groups.flatMap(group => {
    const groupHeader = group.heading || group.header || ''
    return (group.questions ?? []).map(q => ({
      question: q.question,
      header: groupHeader || q.question,
      options: (q.options ?? []).map(o => ({ label: o.label, description: o.description })),
      multiple: q.type === 'multi_select',
      custom: q.custom ?? true,
    }))
  })
}

/**
 * Format framework QuestionGroup[] as readable text for display as an assistant message.
 */
export function formatFrameworkQuestionsAsText(
  groups: FrameworkQuestionGroup[]
): string {
  const flattened = flattenFrameworkQuestionGroups(groups)
  return formatQuestionsAsText(flattened)
}

// ---------------------------------------------------------------------------
// Question activity record creation
// ---------------------------------------------------------------------------

/**
 * Create an activity record when a question is asked during workflow execution.
 * This notifies the user that the agent has a question waiting for their response.
 */
export async function createQuestionActivity(executionId: string): Promise<void> {
  try {
    const db = DatabaseClient.getInstance()
    const execution = await repositories.workflowExecutions.findById(executionId)
    const workflowId = execution?.workflowId
    if (workflowId) {
      const workflow = await repositories.workflows.findById(workflowId)
      const ticketId = workflow?.ticketId
      if (ticketId) {
        const ticket = await db.ticket.findUnique({ where: { id: ticketId } })
        const userId = (execution as any)?.createdBy || ticket?.createdBy
        if (userId) {
          const workflowBot = await unifiedBotUserService.getBotByEmail('workflow-bot@bot.xyne.ai')
          await activityService.createActivity({
            userId,
            actorAction: 'workflow_question',
            actionSource: 'workflow',
            actionSourceId: workflowId,
            ticketId,
            actorId: workflowBot?.id || 'system',
            classification: ActivityClassification.ACTIONABLE,
          })
        }
      }
    }
  } catch (activityError) {
    logger.warn(`[ExternalStepUtils] Failed to create question activity record:`, activityError)
  }
}
