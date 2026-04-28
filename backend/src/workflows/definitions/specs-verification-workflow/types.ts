
export interface AIServiceResponse {
    content: string;
    model: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface AIServiceRequest {
    model: string;
    messages: Array<{role: string; content: string}>;
}

export enum SpecsVerificationWorkflowSteps {
    READ_TICKET = 'read_ticket',
    GET_DOCUMENTS = 'get_documents',
    EXTRACT_CURLS = 'extract_curls',
    VERIFY_CURLS = 'verify_curls',
    SPECS_VERIFIED = 'specs_verified',
    AGENT_ITERATION_LOOP = 'agent_iteration_loop',
  }

export interface SpecVerificationWorkflowOutput<T=VerificationAgentOutput> {
  sessionsAnalyzed: number;
  passed: Boolean;
  agenticOutput: T;
}

export interface VerificationAgentOutput {
  resultConcluded: Boolean;
  specsVerified: Boolean;
  errorMessage: string | null;
  sucessMessage: string | null;
  successSpecs: SuccessSpec[]|null;
  failedSpecs: FailedSpec[]|null;
  errorEmail: {emailSubject: string, emailBody: string} | null;
}

export interface SuccessSpec{
  request_name: string;
  request_url: string;
  request_curl: string;
  request_body: any;
  request_headers: any;
  request_params: any;
  http_method: string
  response_body: any;
  response_headers: any;
  expected_response_body: any;
  expected_response_headers: any;
  error_reason: string;
  error_fields: [string];
 }

export interface FailedSpec {
  request_name: string;
  request_url: string;
  request_curl: string;
  request_body: any;
  request_headers: any;
  request_params: any;
  http_method: string
  response_body: any;
  response_headers: any;
  expected_response_body: any;
  expected_response_headers: any;
  error_reason: string;
  error_fields: [string];
 }

export type SpecVerificationAiResponse =
            | {
                action: "RUN_CURL";
                action_input: RunCurlInput;
                next_context: any;
                rawResponse: null;
              }
            | {
                action: "FETCH_ATTACHMENT";
                action_input: FetchAttachmentInput;
                next_context: any;
                rawResponse: null;
              }
            | {
                action: "TASK_COMPLETED";
                action_input: TaskCompletedInput;
                next_context: any;
                rawResponse: null;
              }
            | {
                action: "ERROR_RESPONSE" | "READ_TICKET" | "GET_ATTACHMENTS";
                action_input: null;
                next_context: any;
                rawResponse: string | null;
              };

interface FetchAttachmentInput {
  attachment_name: string;
}

interface RunCurlInput {
  request_url: string;
  http_method:  "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  request_headers?: Record<string, string>;
  request_body: any;
 }

interface TaskCompletedInput {
  specs_verification: "SUCCESS" | "FAIL";
  user_message: string;
  erorr_curl_info: [FailedSpec]|null;
  success_curl_info: [SuccessSpec]|null;
  email_body: string|null;
  email_subject: string|null;
 }

 export type FileDataExtractionAIResponse =
 | {
     action: "READ_FILE";
     action_input: ReadFileInput;
     next_context: {
      curl_data_extracted: FileData;
      memory: any;
     };
   }
 | {
      action: "TASK_COMPLETE";
      action_output: {
        curl_data_extracted: FileData;
        error: any;
      };
  }
  | { action: 'ERROR_RESPONSE'
    , rawResponse: any
  };

interface ReadFileInput {
  offset: number;
  buffer: number
}

export interface FileData {
  fileDescription: string;
  curlData: CurlData[];
}

interface CurlData {
  url: string;
  request_body: ParameterDetail[];
  query_params: ParameterDetail[];
  request_headers: ParameterDetail[];
  expected_response: ResponseDetail[];
}

interface ParameterDetail {
  field_name: string;
  field_type: string;
  field_description: string;
}

interface ResponseDetail {
  field_name: string;
  field_type:string;
  expected_response:any;
  field_description:string;
}

export interface VerifyActionBank {
  read_ticket_response?: string;
  get_attachment_response?: string;
  fetch_attachment_response: AttachmentDetails[];
}

export interface AttachmentDetails {
  attachment_name: string;
  response: string;
}