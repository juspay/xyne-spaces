import { WorkflowEngine, BaseWorkflowContext, ExternalStepRequestResult, RequestHandlerSuccess } from '../../workflow-types'
import { WorkflowDefinition } from '../../registry/workflowRegistry'
import { WorkflowType } from '../../types/workflow-enums'
import { z } from 'zod'
import { logger } from '@/utils/logger'
import { superpositionClient } from '@/services/superpositionClient'

import { SupportBot } from '@/bots/implementations/support-bot/support-bot'
import { Agent, createUserMessage } from 'agentic-framework'
import { agentService } from '@/services/agentService'

export interface SupportQueryContext extends BaseWorkflowContext {
  ticketId: string
  queryText: string
  querySubType?: string 
  conversationId: string
  channelId: string
  attachments?: string[] 
  userId: string
}

export interface SupportQueryOutput {
  responseGenerated: boolean
  documentsFetched: string[]
  escalated: boolean
  escalationReason?: string
}

export interface UserAction {
  approved: boolean
  status: string
  decision: string
}

export enum SupportQuerySteps {
  INITIALIZE_TICKET = 'initialize_ticket',
  ANALYZE_QUERY = 'analyze_query',
  FETCH_DOCUMENTS = 'fetch_documents',
  WAIT_USER_DECISION = 'wait_user_decision',
}

const CAC_KEYS = {
  support_queries: 'support_queries',
} as const;


export const supportQueryInputSchema = z.object({
  ticketId: z.string(),
  queryText: z.string().min(1, 'Query text is required'),
  querySubType: z.string().optional(),
  conversationId: z.string(),
  channelId: z.string(),
  userId: z.string(),
  attachments: z.array(z.string()).optional(),
})

export const supportQueryContextMapper = (
  payload: z.infer<typeof supportQueryInputSchema> & { ticketId: string; userId: string; }
): SupportQueryContext => ({
  ticketId: payload.ticketId,
  queryText: payload.queryText,
  querySubType: payload.querySubType,
  conversationId: payload.conversationId,
  channelId: payload.channelId,
  attachments: payload.attachments,
  userId: payload.userId,
})

const supportBot = new SupportBot();

// Derive types from querySchema
type QueryConfig = z.infer<typeof querySchema>
type Query = QueryConfig['queries'][number]

interface DocumentFetchResult {
  found: boolean
  documentNames?: string[]
  gcsPaths?: string[]
}

const querySchema = z.object({
  queries: z.array(
    z.object({
      query: z.string(),
      steps: z.array(z.string()),
      documentUrl: z.array(z.string()).optional(),
    })
  ),
})

/**
 * Load all supported queries from Superposition for agent context
 */
async function loadSupportedQueries(): Promise<Query[]> {
  try {
    const json = await superpositionClient.getObjectValue(CAC_KEYS.support_queries,{queries: []},{})
    const config = querySchema.parse(json);

    if (!config || !config.queries || config.queries.length === 0) {
      logger.warn('[SupportWorkflow] No queries found in config')
      return []
    }

    return config.queries;
  } catch (error) {
    logger.error('[SupportWorkflow] Failed to load supported queries:', error)
    return []
  }
}





/**
 * Build user message for combined classification and response generation
 */
function buildCombinedUserMessage(supportedQueries: Query[], queryText: string): string {
  // Include both queries AND their resolution steps so agent can generate response
  const supportedQueriesText = supportedQueries.length > 0
    ? supportedQueries.map((q, i) => `ID: ${i} | Known Issue: ${q.query}
Resolution Steps:
${q.steps.map((s, stepIdx) => `${stepIdx + 1}. ${s}`).join('\n')}`).join('\n\n')
    : 'No supported queries configured'

  return `Available Supported Issues with Resolution Steps:
${supportedQueriesText}

User Query: "${queryText}"

Please analyze this query, find the best matching issue, and generate a response using the resolution steps from the matched issue.`
}




interface CombinedAnalysisResult {
  matchedId: number | null;
  responseText: string;
}

async function classifyQueryWithAI(
  queryText: string,
  supportedQueries: Query[],
  ticketId: string,
): Promise<CombinedAnalysisResult> {
  logger.info(`[SupportWorkflow] Processing query with AI: "${queryText.substring(0, 100)}..."`)

  try {
    const { config: agentConfig, systemPrompt } = await agentService.getAgentConfigWithSystemPrompt(
      'support-query-processor',
      { ticketId },
    );

    const agent = Agent.create(agentConfig);

    const userMessage = buildCombinedUserMessage(supportedQueries, queryText)

    // Execute agent with the system prompt from database
    const result = await agent.execute({
      messages: [createUserMessage(userMessage)],
      systemPrompt,
    })

    if (!['completed', 'max_turns'].includes(result.status as string)) {
      throw new Error(`Agent execution failed with status: ${result.status}`)
    }

    const lastMessage = result.messages.at(-1)
    if (!lastMessage || !('content' in lastMessage) || !lastMessage.content) {
      throw new Error('No content in agent response')
    }

    const rawOutput = lastMessage.content
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response')
    }

    const parsed = JSON.parse(jsonMatch[0])
    logger.info(`[SupportWorkflow] Combined result:`, parsed)
    logger.info('[SupportWorkflow] Raw combined output:', rawOutput)
    return {
      matchedId: parsed.matchedId,
      responseText: parsed.responseText || 'No response generated',
    }
  } catch (error) {
    logger.error('[SupportWorkflow] AI processing failed:', error)
    return {
      matchedId: null,
      responseText: 'Unable to process your request. Please contact support.',
    }
  }
}

/**
 * Initialize ticket by assigning to support-bot 
 */
async function initializeTicketHandler(
  ticketId: string,
  conversationId: string
): Promise<{ initialized: boolean; assignedTo: string | null }> {
  logger.info(`[SupportWorkflow] Initializing ticket ${ticketId}`)

  try {

    const botUserId = supportBot.getBotUserId();
    // Update assignee and stage in one call
    await supportBot.updateTicket(ticketId, conversationId, { assigneeId: botUserId, stage: 'AI_PICKED_UP' });

    logger.info(`[SupportWorkflow] Ticket ${ticketId} assigned to support-bot and stage updated to AI_PICKED_UP`)
    return { initialized: true, assignedTo: botUserId }
  } catch (error) {
    logger.error('[SupportWorkflow] Failed to initialize ticket:', error)
    return { initialized: false, assignedTo: null }
  }
}

/**
 * Fetch relevant documents from GCS based on query analysis
 */
async function fetchDocumentsHandler(
  matchedId: number | null,
  supportedQueries: Query[]
): Promise<DocumentFetchResult> {
  logger.info(`[SupportWorkflow] Fetching documents for matchedId: ${matchedId}`)

  try {
    // If no matched ID, can't fetch documents
    if (matchedId === null) {
      logger.warn(`[SupportWorkflow] No matched ID provided`)
      return {
        found: false,
      }
    }

    // Check if matchedId is valid
    if (matchedId < 0 || matchedId >= supportedQueries.length) {
      logger.warn(`[SupportWorkflow] Invalid matchedId: ${matchedId}`)
      return {
        found: false,
      }
    }

    // Get the matching query
    const matchingQuery = supportedQueries[matchedId]

    if (!matchingQuery) {
      logger.warn(`[SupportWorkflow] No matching query found for matchedId: ${matchedId}`)
      return {
        found: false,
      }
    }

    // Check if query has document IDs
    if (!matchingQuery.documentUrl || matchingQuery.documentUrl.length === 0) {
      logger.warn(`[SupportWorkflow] No troubleshooting docs configured for query: ${matchingQuery.query}`)
      return {
        found: false,
      }
    }

    logger.info(`[SupportWorkflow] Document metadata retrieved: ${matchingQuery.documentUrl.join(', ')}`)

    return {
      found: true,
      documentNames: [matchingQuery.query],
      gcsPaths: matchingQuery.documentUrl,
    }
  } catch (error) {
    logger.error('[SupportWorkflow] Error fetching documents:', error)
    return {
      found: false,
    }
  }
}

async function runSupportBot(
  workflowExecutionId: string, 
  workflowStepId: string,
  context: SupportQueryContext,
  responseResult: string,
  documentResult: DocumentFetchResult
): Promise<ExternalStepRequestResult<never>> {
  await supportBot.sendSupportMessage({
    conversationId: context.conversationId,
    ticketId: context.ticketId,
    responseText: responseResult,
    userId: context.userId,
    gcsPaths: documentResult.gcsPaths,
    documentNames: documentResult.documentNames,
    workflowExecutionId,
    workflowStepId,
    isEscalation: false,
  })

  return RequestHandlerSuccess();
}


export const itSupportWorkflow: WorkflowDefinition<
  SupportQueryContext,
  SupportQueryOutput,
  typeof SupportQuerySteps
> = {
  type: WorkflowType.IT_SUPPORT_WORKFLOW,
  name: 'IT Support Workflow',
  description: '_HIDDEN_Generic support query workflow with AI classification, document retrieval, and user-driven escalation',
  inputSchema: supportQueryInputSchema,
  contextMapper: supportQueryContextMapper,
  category: 'support',
  priority: 'high',

  async execute(
    engine: WorkflowEngine<SupportQueryContext, typeof SupportQuerySteps>
  ): Promise<SupportQueryOutput> {
    const context = engine.getContext()
    const { queryText, ticketId, channelId } = context

    logger.info(`🎫 [IT Support Workflow] Starting for ticket: ${ticketId}`)

    // Validate this is a support channel
    const isSupport = await supportBot.validateChannel(channelId)
    if (!isSupport) {
      logger.warn(`[SupportWorkflow] Channel ${channelId} is not configured as a support channel`)
      throw new Error('Workflow can only be triggered in configured support channels')
    }

    // Load supported queries from Superposition
    const supportedQueries = await loadSupportedQueries()
    logger.info(`📋 Loaded ${supportedQueries.length} supported queries from config`)

    // STEP 0: Initialize Ticket - Assign to support-bot and update status
    const initResult = await engine.createCheckpoint(
      SupportQuerySteps.INITIALIZE_TICKET,
      initializeTicketHandler,
      ticketId,
      context.conversationId
    )

    logger.info(`Step 0 Complete: Ticket Initialization`)
    logger.info(`   Initialized: ${initResult.initialized}`)

    // STEP 1: AI Classification
    const analysisResult = await engine.createCheckpoint(
      SupportQuerySteps.ANALYZE_QUERY,
      classifyQueryWithAI,
      queryText,
      supportedQueries,
      ticketId
    )

    logger.info(`Step 1 Complete: Classification`)
    logger.debug('[SupportWorkflow] Analysis result:', analysisResult)

    // STEP 2: Fetch Documents (Deterministic)
    const documentResult = await engine.createCheckpoint(
      SupportQuerySteps.FETCH_DOCUMENTS,
      fetchDocumentsHandler,
      analysisResult.matchedId,
      supportedQueries
    )

    logger.info(`Step 2 Complete: Documents Fetched`)
    logger.info(`   Found: ${documentResult.found}`)
    logger.info(`   Documents: ${documentResult.found ? documentResult.documentNames?.join(', ') : 'None'}`)

    const handleUserAction = async (rawResponse: string) => {
      let userActionPayload: UserAction;
      try{
        userActionPayload = JSON.parse(rawResponse) as UserAction
      }
      catch(e){
        throw new Error(`Failed to parse user action payload: ${rawResponse}`);
      }
      logger.info(`Step 3 Complete: User Decision Received: ${userActionPayload.decision}`)

      if(userActionPayload.decision === "resolved"){
        await supportBot.updateTicket(ticketId, context.conversationId, { stage: 'COMPLETED' });
      }
      else if(userActionPayload.decision === "escalate"){
        const userGroup = await supportBot.getSupportGroup();
        
        // Assign user group and update stage in one call
        await supportBot.updateTicket(ticketId, context.conversationId, { groupId: userGroup!.id, stage: 'HUMAN_INTERVENTION' });
        
        // Send escalation message
        await supportBot.sendSupportMessage({
          conversationId: context.conversationId,
          ticketId: context.ticketId,
          userId: context.userId,
          isEscalation: true,
        })
      }
      return userActionPayload;
    }

    const userAction = await engine.createExternalStep<
      { decision: string },
      [SupportQueryContext, string, DocumentFetchResult]
    >(
      SupportQuerySteps.WAIT_USER_DECISION,
      {
        type: 'user_approval',
        title: 'Waiting for user decision...',
        responseSchema: {
          fields: [
            {
              type: 'select',
              name: 'decision',
              label: 'How would you like to proceed?',
              required: true,
              options: [
                { label: 'resolved', value: 'resolved' },
                { label: 'escalate', value: 'escalate' }
              ]
            }
          ],
          description: 'Please select whether your issue was resolved or if you want to escalate to the support team for further assistance.',
          submitLabel: 'Submit',
          cancelLabel: 'Cancel'
        }
      },
      runSupportBot,
      handleUserAction,
      context,
      analysisResult.responseText,
      documentResult
    );

    return {
      responseGenerated: !!analysisResult.responseText,
      documentsFetched: documentResult.found && documentResult.documentNames ? documentResult.documentNames : [],
      escalated: userAction.decision === 'escalate',
    }
  },
}
