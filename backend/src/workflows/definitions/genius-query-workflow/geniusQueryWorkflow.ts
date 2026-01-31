// Genius Query Workflow - Automated ticket investigation and categorization

import { WorkflowEngine, BaseWorkflowContext, RequestHandlerSuccess } from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType, AI_STAGES } from '../../types/workflow-enums';
import { z } from 'zod';
import {
  fetchTicketDetails,
  initiateInvestigationAndWaitForWebhook,
  processGeniusWebhookResponse,
  processMerchantSelectionResponse,
  fetchCompletedInvestigation,
  getDraftResponse,
  createTicketMessage,
  createInvestigationCanvas,
  shareCanvasLink,
  categorizateAndUpdateTicket,
  assignTicketByQueryType,
  stripHtml,
  InvestigationStepResult,
} from './helpers';
import type { GeniusQueryWorkflowOutput, MerchantIdErrorData } from './types';
import { ticketService } from '@/services/ticketService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';

// Context Interface
export interface GeniusQueryWorkflowContext extends BaseWorkflowContext {
  ticketId: string;
}

// Step IDs
export enum GeniusQueryWorkflowSteps {
  FETCH_TICKET_DETAILS = 'fetch_ticket_details',
  CATEGORIZE_AND_UPDATE = 'categorize_and_update',
  ASSIGN_BY_QUERY_TYPE = 'assign_by_query_type',  // Auto-assign based on Query Type
  SELECT_MERCHANT_ID = 'select_merchant_id',  // Human intervention to select merchant_id
  TRY_INVESTIGATING_WITH_GENIUS_WITHOUT_HI = 'try_investigating_with_genius_without_hi',  // External step: initiates investigation and waits for webhook
  INVESTIGATE_WITH_GENIUS = 'investigate_with_genius',  // External step: initiates investigation and waits for webhook
  FETCH_INVESTIGATION_RESULT = 'fetch_investigation_result',  // Fetch completed result after webhook
  CREATE_CANVAS = 'create_canvas',
  SHARE_CANVAS_LINK = 'share_canvas_link',
  GET_DRAFT_RESPONSE = 'get_draft_response',
  CREATE_TICKET_MESSAGE = 'create_ticket_message',
}

// Input Schema - Only requires ticketId
export const geniusQueryWorkflowInputSchema = z.object({
  ticketId: z.string(),
});

// Context Mapper
export const geniusQueryWorkflowContextMapper = (
  payload: { ticketId: string }
): GeniusQueryWorkflowContext => ({
  ticketId: payload.ticketId,
});

// Workflow Definition
export const geniusQueryWorkflow: WorkflowDefinition<
  GeniusQueryWorkflowContext,
  GeniusQueryWorkflowOutput,
  typeof GeniusQueryWorkflowSteps
> = {
  type: WorkflowType.GENIUS_QUERY_WORKFLOW,
  name: 'Genius Query Workflow',
  description: 'Automated workflow for ticket investigation using Genius API with query routing, status polling, and categorization',
  inputSchema: geniusQueryWorkflowInputSchema,
  contextMapper: geniusQueryWorkflowContextMapper,
  tags: ['genius', 'investigation', 'automation', 'categorization'],
  category: 'support',
  estimatedDuration: 600000, // 10 minutes

  async execute(
    engine: WorkflowEngine<GeniusQueryWorkflowContext, typeof GeniusQueryWorkflowSteps>
  ): Promise<GeniusQueryWorkflowOutput> {

    const {ticketId} = engine.getContext()
    const geniusBotUser = await unifiedBotUserService.getBotByEmail('genius@bot.xyne.ai');
    const botUserId = geniusBotUser?.id || "cmjkaarlq0002jq9om34yalc7";

    await ticketService.updateTicketStageForWorkflow(ticketId, botUserId, AI_STAGES.AI_PICKED_UP)

    const ticketDetails = await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.FETCH_TICKET_DETAILS,
      fetchTicketDetails,
      ticketId
    );

    if (!ticketDetails.zohoTicketId) {
      throw new Error('Zoho Ticket ID not found in ticket metadata. Cannot proceed with investigation.');
    }

    const zohoTicketId = ticketDetails.zohoTicketId;
    const email = ticketDetails.email || 'default@example.com';
    
    const cleanTitle = stripHtml(ticketDetails.title);
    const cleanDescription = stripHtml(ticketDetails.description);
    const query = `${cleanTitle}. ${cleanDescription}`;

    const categorizationResult = await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.CATEGORIZE_AND_UPDATE,
      categorizateAndUpdateTicket,
      ticketId,
      zohoTicketId
    );

    await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.ASSIGN_BY_QUERY_TYPE,
      assignTicketByQueryType,
      ticketId,
      categorizationResult.queryType,
      botUserId
    );

    // Try to initiate investigation with webhook
    const investigationResult = await engine.createExternalStep<
      InvestigationStepResult,
      [string, string, string, string, string | undefined],
      MerchantIdErrorData
    >(
      GeniusQueryWorkflowSteps.TRY_INVESTIGATING_WITH_GENIUS_WITHOUT_HI,
      {
        type: 'webhook',
        title: 'Genius Investigation - Waiting for completion webhook'
      },
      initiateInvestigationAndWaitForWebhook,
      processGeniusWebhookResponse,
      ticketId,
      zohoTicketId,
      query,
      email,
      undefined  // No merchant_id initially
    );

    let sessionId: string;

    // Handle merchant selection if needed
    if (investigationResult.needsMerchantSelection) {
      const merchantOptions = investigationResult.merchantIdOptions;
      
      if (merchantOptions.length === 0) {
        throw new Error('Merchant ID mismatch but no options provided by API');
      }

      // Ask user to select merchant_id
      const merchantSelection = await engine.createExternalStep<
        { merchant_id: string },
        []
      >(
        GeniusQueryWorkflowSteps.SELECT_MERCHANT_ID,
        {
          type: 'user_approval',
          title: 'Merchant ID Selection Required',
          responseSchema: {
            fields: [
              {
                type: 'select',
                name: 'merchant_id',
                label: 'Select Merchant ID',
                required: true,
                allowCustomValue: true,
                placeholder: 'Search or enter merchant ID...',
                options: merchantOptions.map(id => ({
                  label: id,
                  value: id
                }))
              }
            ],
            description: 'The system could not determine the correct merchant ID. Please select from the list below or enter a custom merchant ID.',
            submitLabel: 'Continue Investigation',
            cancelLabel: 'Cancel'
          }
        },
        async () => RequestHandlerSuccess(),
        processMerchantSelectionResponse
      );

      // Retry investigation with selected merchant_id
      const retryResult = await engine.createExternalStep<
        InvestigationStepResult,
        [string, string, string, string, string | undefined],
        MerchantIdErrorData
      >(
        GeniusQueryWorkflowSteps.INVESTIGATE_WITH_GENIUS,
        {
          type: 'webhook',
          title: 'Genius Investigation - Waiting for completion webhook'
        },
        initiateInvestigationAndWaitForWebhook,
        processGeniusWebhookResponse,
        ticketId,
        zohoTicketId,
        query,
        email,
        merchantSelection.merchant_id
      );

      if (retryResult.needsMerchantSelection) {
        throw new Error('Merchant ID selection still required after retry');
      }
      sessionId = retryResult.sessionId;
    } else {
      sessionId = investigationResult.sessionId;
    }

    const investigationDetails = await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.FETCH_INVESTIGATION_RESULT,
      fetchCompletedInvestigation,
      sessionId
    );

    const markdown = investigationDetails.result!.markdown;

    const canvasResult = await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.CREATE_CANVAS,
      createInvestigationCanvas,
      ticketId,
      sessionId,
      investigationDetails
    );

    await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.SHARE_CANVAS_LINK,
      shareCanvasLink,
      ticketId,
      canvasResult.canvasUrl,
      canvasResult.canvasId
    );

    const draftResponse = await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.GET_DRAFT_RESPONSE,
      getDraftResponse,
      sessionId
    );

    await engine.createCheckpoint(
      GeniusQueryWorkflowSteps.CREATE_TICKET_MESSAGE,
      createTicketMessage,
      ticketId,
      draftResponse.draft || draftResponse.message
    );

    await ticketService.updateTicketStageForWorkflow(ticketId, botUserId, AI_STAGES.HUMAN_INTERVENTION);

    return {
      success: true,
      sessionId: sessionId,
      investigationResult: markdown,
      categorizationApplied: true,
      messageCreated: true,
    };
  },
};
