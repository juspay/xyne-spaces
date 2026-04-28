import { WorkflowDefinition } from '../../registry/workflowRegistry.js';
import { WorkflowType, SpecsVerificationWorkFlowContext } from '@/workflows/types/workflow-enums.js';
import { VerificationAgentOutput
  , SuccessSpec
  , FailedSpec
  , SpecVerificationAiResponse
  , SpecsVerificationWorkflowSteps
  , VerifyActionBank
  , AttachmentDetails
  , SpecVerificationWorkflowOutput } from './types.js';
import { repositories } from '@/database/repositories';
import { WorkflowEngine, LoopControl } from '../../workflow-types.js';
import { logger } from "@/utils/logger.js";
import { z } from 'zod';
import { specsVerificationTaskPrompt } from "./prompts.js";
import { handleErrorResponse, getTicketDetails, getAttachments, getAttachmentDetails, runCurl } from "./actions.js"
import { Agent, AgentConfig, createUserMessage, Message } from 'agentic-framework';
import { MessageAttachment, Ticket } from "@prisma/client";
import { agentService } from '@/services/agentService';

const DEFAULT_MAX_ITERATIONS=100;

const SpecsVerificationWorkflowInputSchema = z.object({
  ticketId: z.string().describe('Ticket ID for this workflow execution'),
  gateway: z.string().optional().describe('Payment gateway name (e.g., SETU, PAYU)'),
  maxIterations: z.string().optional().describe('Maximum Number of iterations'),
}).passthrough();

const contextMapper = (payload: any): SpecsVerificationWorkFlowContext => {
  return {
    ticketId: payload.ticketId,
    gateway: payload.gateway,
    maxIterations: payload.maxIterations
  };
};

export const specsVerificationWorkflow: WorkflowDefinition<
  SpecsVerificationWorkFlowContext,
  SpecVerificationWorkflowOutput,
  typeof SpecsVerificationWorkflowSteps
> = {
  type: WorkflowType.SPECS_VERIFICATION_WORKFLOW,
  name: 'Specs Verification Workflow',
  description: 'Automated Verification of API Documents',
  inputSchema: SpecsVerificationWorkflowInputSchema,
  contextMapper,
  execute,
  category: 'Verification',
  tags: ['payments', 'requirement', 'integration', 'documentation'],
  priority: 'medium',
  // estimatedDuration: 15 * 60 * 1000, // 15 minutes
};

async function execute(
  engine: WorkflowEngine<SpecsVerificationWorkFlowContext, typeof SpecsVerificationWorkflowSteps>
): Promise<SpecVerificationWorkflowOutput> {
  const context = engine.getContext();
  const ticketId = context.ticketId;
  const ticket = await repositories.tickets.getTicketById(ticketId);
  const attachments = await repositories.messageAttachments.findByTicketId(ticketId);

  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}, \nworkflow contest: ${engine.getContext()}`);
  }
  const agentOutput = await initiateAgentWithFramework(engine, ticket, attachments);

  const workflowOutput: SpecVerificationWorkflowOutput = {
    sessionsAnalyzed: 1,
    passed: agentOutput.specsVerified,
    agenticOutput: agentOutput
  }
  
  return workflowOutput;
}


async function initiateAgentWithFramework(
  engine: WorkflowEngine<SpecsVerificationWorkFlowContext, typeof SpecsVerificationWorkflowSteps>,
  ticket: Ticket,
  attachments: MessageAttachment[]
): Promise<VerificationAgentOutput> {
  let config: AgentConfig;
  let systemPrompt: string;

  const agentConfig = await agentService.getAgentConfigWithSystemPrompt('specs-verification');
  config = agentConfig.config;
  systemPrompt = agentConfig.systemPrompt;

  const configWithTools = {
    ...config,
    model: {
      ...config.model,
      defaultModel: 'kimi-latest'
    },
    execution: {
      ...config.execution,
      maxTurns: 30
    }
  };

  const agent = Agent.create(configWithTools);
  let aiResponse: SpecVerificationAiResponse | null = null;
  let lastActionResult: string = specsVerificationTaskPrompt;
  let actionBank: VerifyActionBank = {fetch_attachment_response: []};

 
  try {
    logger.info(`[initiateAgentWithFramework] Starting specs verification with agent.execute`);

    await engine.createWhileLoop(
      SpecsVerificationWorkflowSteps.AGENT_ITERATION_LOOP,
      engine.getContext().maxIterations ?? DEFAULT_MAX_ITERATIONS,
      async (iteration, scopedEngine) => {


        const userMessage = createUserMessage(lastActionResult);
        const response = await agent.execute({
                            messages: [userMessage],
                            systemPrompt: systemPrompt,
                          });

        logger.info(`specs verification response (iteration ${iteration}): \n` +  JSON.stringify(response.messages));
  
        const parsedResponse = parseAIResponse(response.messages);
        aiResponse = parsedResponse;
  
        if (parsedResponse.action === "TASK_COMPLETED") {
          scopedEngine.createCheckpoint(
            SpecsVerificationWorkflowSteps.SPECS_VERIFIED,
            (res => Promise.resolve(res)),
            parsedResponse
            );
          return LoopControl.BREAK;
        }
        if (parsedResponse.action === "ERROR_RESPONSE"){
          lastActionResult = handleErrorResponse(parsedResponse);
        } else if (parsedResponse.action === "READ_TICKET"){
          lastActionResult = await scopedEngine.createCheckpoint(
                          SpecsVerificationWorkflowSteps.READ_TICKET,
                          getTicketDetails,
                          ticket,
                          parsedResponse,
                          actionBank
                          );
          actionBank.read_ticket_response = lastActionResult;
        } else if (parsedResponse.action === "GET_ATTACHMENTS"){
          lastActionResult = await scopedEngine.createCheckpoint(
                          SpecsVerificationWorkflowSteps.GET_DOCUMENTS,
                          getAttachments,
                          attachments,
                          parsedResponse,
                          actionBank
                          );
          actionBank.get_attachment_response = lastActionResult;
        } else if (parsedResponse.action === "FETCH_ATTACHMENT"){
          lastActionResult = await scopedEngine.createCheckpoint(
                          SpecsVerificationWorkflowSteps.EXTRACT_CURLS,
                          getAttachmentDetails,
                          attachments,
                          parsedResponse,
                          actionBank
                          );
          appendAttachmentInfo(actionBank.fetch_attachment_response, parsedResponse, lastActionResult);
        } else if (parsedResponse.action === "RUN_CURL"){
          lastActionResult = await scopedEngine.createCheckpoint(
                          SpecsVerificationWorkflowSteps.VERIFY_CURLS,
                          runCurl,
                          actionBank,
                          parsedResponse
                          );
        } else {
          lastActionResult = handleErrorResponse(parsedResponse);
        }
        return LoopControl.CONTINUE;
      }
    );
  } catch (error) {
    logger.error('[initiateAgentWithFramework] Agent execution failed:', error);
    return makeAgentFailureResponse([], []);
  }

  const taskCompletedResponse = aiResponse as Extract<SpecVerificationAiResponse, { action: "TASK_COMPLETED" }> | null;
  if (taskCompletedResponse?.action === "TASK_COMPLETED" && taskCompletedResponse.action_input) {
    const actionInput = taskCompletedResponse.action_input;
    const email = actionInput.email_body && actionInput.email_subject
      ? { emailSubject: actionInput.email_body, emailBody: actionInput.email_subject }
      : null;

    return {
      resultConcluded: true,
      specsVerified: !actionInput.erorr_curl_info,
      errorMessage: "Agent Could not conclude the verification",
      sucessMessage: actionInput.user_message,
      successSpecs: actionInput.success_curl_info,
      failedSpecs: actionInput.erorr_curl_info,
      errorEmail: email
    };
  }

  return Promise.resolve(makeAgentFailureResponse([], []));
}

function parseAIResponse(aiRawMessages: readonly Message[]):SpecVerificationAiResponse {
  const aiTextResponse = aiRawMessages.filter(message => message.type === 'assistant').at(-1)?.content ?? "";
  const jsonStart = aiTextResponse.indexOf('{');
  const jsonEnd = aiTextResponse.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) return parseErrorResponse(aiTextResponse);

  const aiJsonResponse = aiTextResponse.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(aiJsonResponse);
  } catch (e) {
    logger.error("Erorr while parsing spec verification AI Response");
    return parseErrorResponse(aiTextResponse);
  }
}

function makeAgentFailureResponse(successSpecs: SuccessSpec[], failedSpecs: FailedSpec[]):VerificationAgentOutput{
    return {
    resultConcluded: false,
    specsVerified: false,
    errorMessage: "Agent Could not conclude the verification",
    sucessMessage: null,
    successSpecs: successSpecs,
    failedSpecs: failedSpecs,
    errorEmail: null
  }
}

function parseErrorResponse(aiTextResponse: string):SpecVerificationAiResponse {
  return { action: 'ERROR_RESPONSE'
         , rawResponse: aiTextResponse
         , next_context: null
         , action_input: null };
}

function appendAttachmentInfo(currentDetails: AttachmentDetails[], parsedResponse: SpecVerificationAiResponse, attachmentInfo: string) {
  if (parsedResponse.action == "FETCH_ATTACHMENT") {
    const attachmentDetail = {
      attachment_name: parsedResponse.action_input.attachment_name,
      response: attachmentInfo
    };

    currentDetails.push(attachmentDetail);
  }
}