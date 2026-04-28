import { FileDataExtractionAIResponse } from "./types.js";
import * as pdfjsLib from "pdfjs-dist";
import { MessageAttachment } from '@prisma/client';
import { docParserTaskPrompt2 } from "./prompts.js";
import { gcsService } from "@/services/gcsService.js";
import { logger } from "@/utils/logger.js";
import { Agent, AgentConfig, createUserMessage, Message } from 'agentic-framework';
import { agentService } from "@/services/agentService.js";

const docParserTaskPrompt = docParserTaskPrompt2;

export async function extractCurl(attachments:MessageAttachment[], attachment_name: string): Promise<FileDataExtractionAIResponse> {
  const attachmentInfo = attachments.find(a => a.originalFilename == attachment_name);

  if (!attachmentInfo) {
    return Promise.resolve(parseErrorResponse("File not found"));
  }

  // Validate it's a PDF
  if (!attachmentInfo.mimetype.includes('pdf')) {
    return parseErrorResponse(`Expected PDF file, got: ${attachmentInfo.mimetype}`);
  }

  // Fetch file from GCS (or fake-gcs-server) as buffer
  let buffer: Buffer;
  try {
    buffer = await gcsService.getFileBuffer(attachmentInfo.url);
  } catch (error) {
    logger.error(`[FileReadAgent] Failed to fetch file from GCS: ${attachmentInfo.url}`, error);
    return parseErrorResponse(`Failed to fetch file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Parse PDF from buffer directly
  const uint8Array = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  let pdfOutput = ""
  const pdf = await loadingTask.promise;
  for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      const strings = content.items.map((item: any) => item.str);
      pdfOutput = pdfOutput.concat(strings.join(" "), "\n");
  }

  let config: AgentConfig;
  let systemPrompt: string;

  const agentConfig = await agentService.getAgentConfigWithSystemPrompt('document-parsing');
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
  let parsedResponse: FileDataExtractionAIResponse = parseErrorResponse("");
  let nextRequest = docParserTaskPrompt;
  let lastSuccessfulResponse = "";
  let depthRemaining = 50;
  
  while(depthRemaining--) {
    const userMessage = createUserMessage(nextRequest);
    const response = await agent.execute({
                        messages: [userMessage],
                        systemPrompt: systemPrompt,
                      });
    logger.info("file read agent response: \n" +  JSON.stringify(response.messages));
    const textResponse = getAssitantResponse(response.messages);
    parsedResponse = parseAIResponse(textResponse);

    if(parsedResponse.action == "READ_FILE") {
      const inputFileData = pdfOutput.slice(parsedResponse.action_input.offset, parsedResponse.action_input.offset + parsedResponse.action_input.buffer);
      const currentContext = 
              { "goal": docParserTaskPrompt
              , "previous_action": "READ_FILE"
              , "previous_action_input": parsedResponse.action_input
              , "previous_action_output": {"file_contents": inputFileData, "total_file_charecters": pdfOutput.length}
              , "next_context": parsedResponse.next_context};
      nextRequest = JSON.stringify(currentContext);
      lastSuccessfulResponse = nextRequest;
    }
    else if (parsedResponse.action == "TASK_COMPLETE") {
      break;
    }
    else {
      const currentContext = 
              { goal: docParserTaskPrompt
              , error_reason: "Invalid operation in last response"
              , previous_response: textResponse
              , last_successful_response: lastSuccessfulResponse};
      nextRequest = JSON.stringify(currentContext);
    }
  }
  return Promise.resolve(parsedResponse);
}

function getAssitantResponse(aiRawMessages: readonly Message[]): string {
  return aiRawMessages.filter(message => message.type === 'assistant').at(-1)?.content ?? "";
}

function parseAIResponse(aiTextResponse: string):FileDataExtractionAIResponse {
  const jsonStart = aiTextResponse.indexOf('{');
  const jsonEnd = aiTextResponse.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) return parseErrorResponse(aiTextResponse);

  const aiJsonResponse = aiTextResponse.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(aiJsonResponse);
  } catch (e) {
    logger.error("Erorr while parsing file read AI Response: ", e);
    return parseErrorResponse(aiTextResponse);
  }
}

export function parseErrorResponse(aiTextResponse: string):FileDataExtractionAIResponse {
  return { action: 'ERROR_RESPONSE'
         , rawResponse: aiTextResponse};
}
