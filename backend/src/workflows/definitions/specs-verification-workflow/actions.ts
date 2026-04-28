import { SpecVerificationAiResponse, VerifyActionBank } from "./types.js";
import { specsVerificationTaskPrompt } from "./prompts.js";
import { MessageAttachment, Ticket } from '@prisma/client';
import { extractCurl } from "./fileReadAgent.js";
import { logger } from "@/utils/logger.js";

const taskPrompt = specsVerificationTaskPrompt;

export function handleErrorResponse(parsedResponse:SpecVerificationAiResponse) {
    const currentContext = 
      { "goal": taskPrompt
      , "previous_action": "ERROR_RESPONSE"
      , "previous_action_output": {"error_reason": "non json or invalid structure recieved", "raw_response": parsedResponse.rawResponse}
      , "next_context": parsedResponse.next_context};
    return JSON.stringify(currentContext);
  }


export function getTicketDetails(ticket:Ticket, parsedResponse:SpecVerificationAiResponse, actionBank: VerifyActionBank) {
  const { title, description } = ticket
  const currentContext = 
    { "goal": taskPrompt
    , "previous_action": "READ_TICKET"
    , "previous_action_output": {"ticket_info": {title, description}}
    , "next_context": parsedResponse.next_context
    , "actions_responses": actionBank};
  return Promise.resolve(JSON.stringify(currentContext));
}

export function getAttachments(attachments:MessageAttachment[], parsedResponse:SpecVerificationAiResponse, actionBank: VerifyActionBank) {
  const formattedFileNames = attachments.map(a => {return {"file_name": a.originalFilename}})
  const currentContext = 
    { "goal": taskPrompt
    , "previous_action": "GET_ATTACHMENTS"
    , "previous_action_output": {"available_attachments": formattedFileNames}
    , "next_context": parsedResponse.next_context
    , "actions_responses": actionBank};
  return Promise.resolve(JSON.stringify(currentContext));
}

export async function getAttachmentDetails(attachments:MessageAttachment[], parsedResponse:SpecVerificationAiResponse, actionBank: VerifyActionBank) {
  if (parsedResponse.action == "FETCH_ATTACHMENT") {
    const extractResponse = await extractCurl(attachments, parsedResponse.action_input.attachment_name);

    if (extractResponse.action == "ERROR_RESPONSE") {
      const currentContext = 
        { "goal": taskPrompt
        , "previous_action": "FETCH_ATTACHMENT"
        , "previous_action_input": parsedResponse.action_input
        , "previous_action_output": {"error_reason": extractResponse.rawResponse}
        , "actions_responses": actionBank
        , "next_context": parsedResponse.next_context};
      return JSON.stringify(currentContext);

    }
    else if(extractResponse.action == "READ_FILE") {
      const currentContext = 
        { "goal": taskPrompt
        , "previous_action": "FETCH_ATTACHMENT"
        , "previous_action_input": parsedResponse.action_input
        , "previous_action_output": {"attachment_parse_response": extractResponse.next_context.curl_data_extracted, "error_reason": "Not able to parse full document"}
        , "actions_responses": actionBank
        , "next_context": parsedResponse.next_context};
      return JSON.stringify(currentContext);

    }else {
      const currentContext = 
        { "goal": taskPrompt
        , "previous_action": "FETCH_ATTACHMENT"
        , "previous_action_input": parsedResponse.action_input
        , "previous_action_output": {"attachment_parse_response": extractResponse.action_output}
        , "actions_responses": actionBank
        , "next_context": parsedResponse.next_context};
      return JSON.stringify(currentContext);
    }

  }
  const currentContext = 
    { "goal": taskPrompt
    , "previous_action": "FETCH_ATTACHMENT"
    , "previous_action_input": parsedResponse.action_input
    , "previous_action_output": {"action_error": "improper inputs provided"}
    , "actions_responses": actionBank
    , "next_context": parsedResponse.next_context
    };
  return JSON.stringify(currentContext);
}

export async function runCurl(actionBank: VerifyActionBank, parsedResponse:SpecVerificationAiResponse){
  if (parsedResponse.action == "RUN_CURL"){  
    const {request_url, http_method, request_headers, request_body } = parsedResponse.action_input
    
    try {
      const res = await fetch(request_url, {
        method: http_method,
        headers: {
          "Content-Type": "application/json",
          ...request_headers,
        },
        body: request_body ? JSON.stringify(request_body) : undefined,
      });

      const status = res.status;
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const responseText = await res.text();

      let body: any;
      try {
        body = JSON.parse(responseText);
      } catch {
        body = responseText;
      }
      
      const currentContext = 
      { "goal": taskPrompt
      , "previous_action": "RUN_CURL"
      , "previous_action_output": {"response_headers": headers, "response_code": status, "response_body": body}
      , "actions_responses": actionBank
      , "next_context": parsedResponse.next_context};

      return JSON.stringify(currentContext);
    }
    catch (e) {
      logger.error("Error while calling API");
      const currentContext = 
      { "goal": taskPrompt
      , "previous_action": "RUN_CURL"
      , "previous_action_output": "Error while calling API, could not get response"
      , "actions_responses": actionBank
      , "next_context": parsedResponse.next_context};

      return JSON.stringify(currentContext);
    }
    
  }
  else {
    const currentContext = 
      { "goal": taskPrompt
      , "previous_action": "RUN_CURL"
      , "previous_action_input": parsedResponse.action_input
      , "previous_action_output": {"action_error": "improper inputs provided"}
      , "actions_responses": actionBank
      , "next_context": parsedResponse.next_context
      };
    return JSON.stringify(currentContext);
  }
}
