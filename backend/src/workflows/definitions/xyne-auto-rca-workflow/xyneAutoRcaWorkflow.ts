// Xyne Auto RCA Workflow - RCA investigation using Genius v3 Investigation API

import { WorkflowEngine } from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType } from '../../types/workflow-enums';
import { z } from 'zod';
import {
  fetchTicketDetails,
  fetchUserContext,
  fetchExecutionCreatedBy,
  initiateRcaInvestigationAndWaitForWebhook,
  processRcaWebhookResponse,
  fetchCompletedInvestigation,
  createInvestigationCanvas,
  shareCanvasLink,
  stripHtml,
} from './helpers';
import type {
  XyneAutoRcaWorkflowContext,
  XyneAutoRcaWorkflowOutput,
  RcaInvestigationStepResult,
  RcaUserContext,
} from './types';

// Step IDsp
export enum XyneAutoRcaWorkflowSteps {
  FETCH_TICKET_DETAILS = 'fetch_ticket_details',
  FETCH_USER_CONTEXT = 'fetch_user_context',
  INITIATE_RCA_INVESTIGATION = 'initiate_rca_investigation',
  FETCH_INVESTIGATION_RESULT = 'fetch_investigation_result',
  CREATE_CANVAS = 'create_canvas',
  SHARE_CANVAS_LINK = 'share_canvas_link',
}

// Input Schema - Only ticketId is required from user
// userId is auto-injected by workflowController from authenticated session (req.user.id)
export const xyneAutoRcaWorkflowInputSchema = z.object({
  ticketId: z.string(),
});

// Context Mapper - userId is fetched from WorkflowExecution.createdBy at runtime
export const xyneAutoRcaWorkflowContextMapper = (
  payload: { ticketId: string }
): XyneAutoRcaWorkflowContext => ({
  ticketId: payload.ticketId,
});

// Workflow Definition
export const xyneAutoRcaWorkflow: WorkflowDefinition<
  XyneAutoRcaWorkflowContext,
  XyneAutoRcaWorkflowOutput,
  typeof XyneAutoRcaWorkflowSteps
> = {
  type: WorkflowType.XYNE_AUTO_RCA_WORKFLOW,
  name: 'Xyne Auto RCA Workflow',
  description: 'Automated RCA investigation workflow using Genius v3 Investigation API with webhook-based async processing',
  inputSchema: xyneAutoRcaWorkflowInputSchema,
  contextMapper: xyneAutoRcaWorkflowContextMapper,
  tags: ['rca', 'investigation', 'automation', 'genius'],
  category: 'support',
  estimatedDuration: 600000, // 10 minutes

  async execute(
    engine: WorkflowEngine<XyneAutoRcaWorkflowContext, typeof XyneAutoRcaWorkflowSteps>
  ): Promise<XyneAutoRcaWorkflowOutput> {
    const { ticketId } = engine.getContext();

    // Step 1: Fetch ticket details
    const ticketDetails = await engine.createCheckpoint(
      XyneAutoRcaWorkflowSteps.FETCH_TICKET_DETAILS,
      fetchTicketDetails,
      ticketId
    );

    // Build query from ticket title and description
    const cleanTitle = stripHtml(ticketDetails.title);
    const cleanDescription = stripHtml(ticketDetails.description);
    const query = `${cleanTitle}. ${cleanDescription}`;

    // Step 2: Get user ID from WorkflowExecution.createdBy
    // This is set by workflowManager when the workflow is triggered
    const executionId = engine.getWorkflowExecutionId();
    const userIdToUse = await fetchExecutionCreatedBy(executionId);
    if (!userIdToUse) {
      throw new Error('User ID is required to initiate RCA investigation. WorkflowExecution.createdBy is not set.');
    }

    // Step 3: Fetch user context for API headers
    const userContext = await engine.createCheckpoint(
      XyneAutoRcaWorkflowSteps.FETCH_USER_CONTEXT,
      fetchUserContext,
      userIdToUse
    );

    // Step 3: Initiate RCA investigation with webhook
    const investigationResult = await engine.createExternalStep<
      RcaInvestigationStepResult,
      [string, RcaUserContext]
    >(
      XyneAutoRcaWorkflowSteps.INITIATE_RCA_INVESTIGATION,
      {
        type: 'webhook',
        title: 'RCA Investigation - Waiting for completion webhook'
      },
      initiateRcaInvestigationAndWaitForWebhook,
      processRcaWebhookResponse,
      query,
      userContext
    );

    const sessionId = investigationResult.sessionId;

    // Step 4: Fetch completed investigation result (POST with session_id)
    const investigationDetails = await engine.createCheckpoint(
      XyneAutoRcaWorkflowSteps.FETCH_INVESTIGATION_RESULT,
      fetchCompletedInvestigation,
      sessionId,
      userContext
    );

    const markdown = investigationDetails.result?.markdown || '';

    // Step 5: Create canvas with investigation results
    const canvasResult = await engine.createCheckpoint(
      XyneAutoRcaWorkflowSteps.CREATE_CANVAS,
      createInvestigationCanvas,
      ticketId,
      sessionId,
      investigationDetails
    );

    // Step 6: Share canvas link in conversation
    await engine.createCheckpoint(
      XyneAutoRcaWorkflowSteps.SHARE_CANVAS_LINK,
      shareCanvasLink,
      ticketId,
      canvasResult.canvasUrl,
      canvasResult.canvasId
    );

    return {
      success: true,
      sessionId,
      investigationResult: markdown,
      canvasUrl: canvasResult.canvasUrl,
      canvasId: canvasResult.canvasId,
    };
  },
};
