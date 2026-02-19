/**
 * External step utilities for the question/answer flow.
 *
 * Handles:
 *  - Creating external step inputs (engine convention)
 *  - Building question response schemas for the approval dialog
 *  - Retrieving and parsing stored question answers
 *  - Sending question notifications (Redis broadcast, persistent notifications, activity records)
 *  - Orchestrating the full "ask a question" flow (createExternalStepInput + notify + WAIT_FOR_EVENT)
 */

import { WorkflowStorage } from '../workflow-storage'
import { WorkflowExecutionStatus } from '../types/workflow-enums'
import { repositories } from '@/database/repositories'
import { logger } from '@/utils/logger'
import { config as appConfig } from '@/config/env'
import { ActivityClassification } from '@prisma/client'
import { DatabaseClient } from '@/database/client'
import { activityService } from '@/services/activity/activityService'
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service'
import type { QuestionAskedEvent } from '../framework/opencode/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExternalStepInputMetadata {
  type: string
  title: string
  response_schema?: Record<string, unknown>
}

export interface StoredQuestionAnswer {
  answers: string[][]
  questionTexts: string[]
  stepName: string
}

// ---------------------------------------------------------------------------
// Create external step INPUT (engine convention)
// ---------------------------------------------------------------------------

/**
 * Create an external step INPUT on an execution, using the engine's data format.
 * Returns the created (or existing) workflow step.
 *
 * For `user_approval` type steps, the storage layer automatically sends
 * an approval nudge bot message to the associated ticket conversation.
 */
export async function createExternalStepInput(
  storage: WorkflowStorage,
  executionId: string,
  stepName: string,
  args: unknown[],
  metadata: ExternalStepInputMetadata,
  subType?: string
) {
  return storage.saveExternalStepInputIfNotExists(
    executionId,
    stepName,
    {
      args,
      externalMetadata: {
        type: metadata.type,
        title: metadata.title,
        response_schema: metadata.response_schema,
      },
    },
    subType ?? metadata.type
  )
}

// ---------------------------------------------------------------------------
// Question response schema builder
// ---------------------------------------------------------------------------

export function buildQuestionResponseSchema(questions: QuestionAskedEvent['properties']['questions']) {
  const fields = questions.map((q, idx) => {
    const fieldName = `question_${idx}`
    const hasOptions = q.options && q.options.length > 0
    if (hasOptions) {
      return {
        name: fieldName,
        label: q.question,
        description: q.header && q.header !== q.question ? q.header : undefined,
        type: 'select' as const,
        required: true,
        options: q.options.map((opt: { label: string; description?: string }) => ({
          value: opt.label,
          label: opt.description ? `${opt.label} — ${opt.description}` : opt.label,
        })),
        allowCustomValue: q.custom ?? true,
        placeholder: 'Select an option or type a custom answer...',
      }
    }
    return {
      name: fieldName,
      label: q.question,
      description: q.header && q.header !== q.question ? q.header : undefined,
      type: 'textarea' as const,
      required: true,
      placeholder: 'Type your answer...',
      rows: 3,
    }
  })

  return {
    fields,
    description: 'The agent has questions before proceeding. Please answer below:',
    submitLabel: 'Submit Answer',
    cancelLabel: 'Cancel',
  }
}

// ---------------------------------------------------------------------------
// Stored answer retrieval & parsing
// ---------------------------------------------------------------------------

/**
 * Retrieve a previously submitted answer for an external question step.
 * Returns null if no response has been submitted yet.
 */
export async function getStoredQuestionAnswer(executionId: string): Promise<StoredQuestionAnswer | null> {
  try {
    const responses = await repositories.externalStepResponses.findByWorkflowExecutionId(executionId)
    if (responses.length === 0) return null

    const response = responses[0]
    const inputStep = await repositories.workflowSteps.findById(response.workflowStepId)
    if (!inputStep) return null

    const stepData = inputStep.data ? JSON.parse(inputStep.data) : null
    const questionData = stepData?.args?.[0]
    const questions = questionData?.questions || []
    const questionTexts = questions.map((q: { header?: string; question: string }) => q.header || q.question)
    const questionCount = questions.length

    const answers = processQuestionRawResponse(response.rawResponse, questionCount)
    return { answers, questionTexts, stepName: inputStep.stepName || 'unknown' }
  } catch (error) {
    logger.error(`[ExternalStepUtils] Failed to get stored question answer:`, error)
    return null
  }
}

/**
 * Parse the raw JSON response from the approval dialog into a string[][] structure.
 * Handles both `{ answers: [...] }` and `{ question_0: "...", question_1: "..." }` formats.
 */
export function processQuestionRawResponse(rawResponse: string, questionCount: number): string[][] {
  try {
    const parsed = JSON.parse(rawResponse)

    if (parsed.answers && Array.isArray(parsed.answers)) {
      return parsed.answers
    }

    const answers: string[][] = []
    for (let i = 0; i < (questionCount || 10); i++) {
      const val = parsed[`question_${i}`]
      if (val === undefined && i >= questionCount) break
      answers.push(val ? [String(val)] : ['Proceed with your best judgment'])
    }
    return answers.length > 0 ? answers : [['Proceed with your best judgment']]
  } catch {
    return [['Proceed with your best judgment']]
  }
}

// ---------------------------------------------------------------------------
// Full "handle question" orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full question flow:
 *  1. Build response schema
 *  2. Create external step INPUT
 *  3. Send notifications
 *  4. Mark child execution as WAIT_FOR_EVENT
 *
 * Returns the step name (requestId).
 */
export async function handleOpenCodeQuestion(
  storage: WorkflowStorage,
  childExecutionId: string,
  parentExecutionId: string,
  requestId: string,
  sessionId: string,
  questions: QuestionAskedEvent['properties']['questions']
): Promise<string> {
  const timeoutMinutes = appConfig.questionTimeoutMinutes
  const questionData = {
    requestId,
    sessionId,
    childExecutionId,
    parentExecutionId,
    questions: questions.map(q => ({
      question: q.question,
      header: q.header,
      options: q.options || [],
      multiple: q.multiple ?? false,
      custom: q.custom ?? true
    })),
    createdAt: new Date().toISOString(),
    timeoutAt: new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString()
  }

  const responseSchema = buildQuestionResponseSchema(questions)

  let externalStepId: string | undefined
  try {
    const externalStep = await createExternalStepInput(
      storage,
      childExecutionId,
      requestId,
      [questionData],
      {
        type: 'user_approval',
        title: 'Agent Question — Waiting for user answer',
        response_schema: responseSchema
      }
    )
    externalStepId = externalStep?.id
    logger.info(`[ExternalStepUtils] ❓ External step created: stepId=${externalStepId}, stepName=${requestId}, executionId=${childExecutionId}`)
  } catch (error) {
    logger.error(`[ExternalStepUtils] Failed to create external step INPUT:`, error)
  }

  try {
    await repositories.workflowExecutions.update(childExecutionId, {
      status: WorkflowExecutionStatus.WAIT_FOR_EVENT
    })
    logger.info(`[ExternalStepUtils] Marked execution ${childExecutionId} as WAIT_FOR_EVENT`)
  } catch (error) {
    logger.error(`[ExternalStepUtils] Failed to mark ${childExecutionId} as WAIT_FOR_EVENT:`, error)
  }

  // Activity record
  try {
    const db = DatabaseClient.getInstance()
    const execution = await repositories.workflowExecutions.findById(childExecutionId)
    const workflowId = execution?.workflowId
    if (workflowId) {
      const workflow = await repositories.workflows.findById(workflowId)
      const ticketId = workflow?.ticketId
      if (ticketId) {
        const ticket = await db.ticket.findUnique({ where: { id: ticketId } })
        const userId = execution?.createdBy || ticket?.createdBy
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
    logger.warn(`[ExternalStepUtils] Failed to create activity record:`, activityError)
  }

  return requestId
}
