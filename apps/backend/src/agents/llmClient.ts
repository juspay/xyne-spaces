import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
// import { LLMClient } from '@framework'; // framework removed
import type { OrgLLMServiceAccountPurpose } from '@xyne/shared';

/** Placeholder for the removed framework client; nothing can construct one. */
export type LLMClient = never;

// LLM framework removed; original kept below.
export async function resolveOrgLLMClient(_opts: {
  modelName: string;
  userId: string;
  projectId?: string | null;
  purpose?: OrgLLMServiceAccountPurpose;
}): Promise<LLMClient> {
  throw new Error('LLM client is not configured');
}

// import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
// import { OrgLLMServiceAccountPurpose } from '@xyne/shared';
//
// // Resolves the org's LiteLLM credential (project account first, falling back to
// // the user's) and builds a client for it — the shared spine every direct-LLM
// // agent used to inline. Pass `projectId` (even null) to use the project→user
// // chain; omit it for user-only resolution.
// export async function resolveOrgLLMClient(opts: {
//   modelName: string;
//   userId: string;
//   projectId?: string | null;
//   purpose?: OrgLLMServiceAccountPurpose;
// }): Promise<LLMClient> {
//   const purpose = opts.purpose ?? OrgLLMServiceAccountPurpose.DEFAULT;
//   const credential =
//     ('projectId' in opts
//       ? await orgLLMCredentialService.getCredentialByProjectId(opts.projectId ?? null, purpose)
//       : null) ?? (await orgLLMCredentialService.getCredentialByUserId(opts.userId, purpose));
//
//   if (!credential) {
//     throw new Error('LiteLLM credentials are not configured for this organization');
//   }
//
//   return new LLMClient({
//     provider: {
//       type: 'litellm',
//       config: { apiKey: credential.apiKey, baseUrl: credential.baseUrl },
//     },
//     defaultModel: opts.modelName,
//   });
// }

// The JAF agent runtime (@juspay-jaf/jaf) was removed: it depends on zod v3 internals, which
// blocks the zod 4 upgrade. The types below mirror the subset of JAF that the agents compile
// against, and every runtime entry point throws, so the agents built on it fail with a clear
// error until they are rebuilt on a new LLM client (see also llmClient.ts).

const NOT_CONFIGURED = 'LLM agent runtime is not configured';

export type TraceId = string & { readonly _brand: 'TraceId' };
export type RunId = string & { readonly _brand: 'RunId' };

export type Attachment = {
  readonly kind: 'image' | 'document' | 'file';
  readonly mimeType?: string;
  readonly name?: string;
  readonly url?: string;
  readonly data?: string;
  readonly format?: string;
  readonly useLiteLLMFormat?: boolean;
};

export type MessageContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image_url';
      readonly image_url: { readonly url: string; readonly detail?: 'low' | 'high' | 'auto' };
    }
  | { readonly type: 'file'; readonly file: { readonly file_id: string; readonly format?: string } };

export type Message = {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string | readonly MessageContentPart[];
  readonly attachments?: readonly Attachment[];
  readonly tool_call_id?: string;
};

export type ModelConfig = {
  readonly name?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
};

export type Tool<A, Ctx> = {
  readonly schema: {
    readonly name: string;
    readonly description: string;
    readonly parameters: z.ZodType<A>;
  };
  readonly execute: (args: A, context: Readonly<Ctx>) => Promise<string>;
};

export type Agent<Ctx, Out> = {
  readonly name: string;
  readonly instructions: (state: Readonly<RunState<Ctx>>) => string;
  readonly tools?: readonly Tool<any, Ctx>[];
  readonly outputCodec?: z.ZodType<Out>;
  readonly modelConfig?: ModelConfig;
};

export type RunState<Ctx> = {
  readonly runId: RunId;
  readonly traceId: TraceId;
  readonly messages: readonly Message[];
  readonly currentAgentName: string;
  readonly context: Readonly<Ctx>;
  readonly turnCount: number;
};

export type JAFError = { readonly _tag: string; readonly [key: string]: unknown };

export type RunOutcome<Out> =
  | { readonly status: 'completed'; readonly output: Out }
  | { readonly status: 'error'; readonly error: JAFError }
  | { readonly status: 'interrupted'; readonly interruptions: readonly unknown[] };

export type RunResult<Out> = {
  readonly finalState: RunState<any>;
  readonly outcome: RunOutcome<Out>;
};

export type TraceEvent =
  | { type: 'llm_call_start'; data: { model?: string } }
  | { type: 'llm_call_end'; data: { choice?: { message?: { content?: string | null } } } }
  | { type: 'assistant_message'; data: { message?: { content?: string | readonly MessageContentPart[] | null } } }
  | { type: 'tool_call_start'; data: { toolName: string } }
  | { type: 'tool_call_end'; data: { toolName: string; result?: string } }
  | { type: 'final_output'; data: { output: unknown } }
  | { type: 'run_end'; data: { outcome: RunOutcome<unknown> } }
  | { type: 'other'; data: Record<string, unknown> };

export interface ModelProvider<Ctx> {
  readonly _context?: Ctx;
}

export type RunConfig<Ctx> = {
  readonly agentRegistry: ReadonlyMap<string, Agent<Ctx, any>>;
  readonly modelProvider: ModelProvider<Ctx>;
  readonly maxTurns?: number;
  readonly modelOverride?: string;
  readonly onEvent?: (event: TraceEvent) => void;
};

export const generateRunId = (): RunId => randomUUID() as RunId;
export const generateTraceId = (): TraceId => randomUUID() as TraceId;

export function makeLiteLLMProvider(_baseUrl: string, _apiKey: string): ModelProvider<any> {
  throw new Error(NOT_CONFIGURED);
}

export async function run<Ctx, Out = string>(
  _state: RunState<Ctx>,
  _config: RunConfig<Ctx>,
): Promise<RunResult<Out>> {
  throw new Error(NOT_CONFIGURED);
}

// eslint-disable-next-line require-yield
export async function* runStream<Ctx>(
  _state: RunState<Ctx>,
  _config: RunConfig<Ctx>,
): AsyncGenerator<TraceEvent, void, unknown> {
  throw new Error(NOT_CONFIGURED);
}

/** JAF mapped its trace ids to OTel trace ids; with no runtime there is nothing to map. */
export function getOtelTraceId(_jafTraceId: string): string | undefined {
  return undefined;
}

type AttachmentParams = {
  readonly name?: string;
  readonly url?: string;
  readonly data?: string | Buffer;
  readonly mimeType?: string;
  readonly format?: string;
};

function buildAttachment(kind: Attachment['kind'], params: AttachmentParams): Attachment {
  const data = typeof params.data === 'string' ? params.data : params.data?.toString('base64');
  if (!params.url && !data) {
    throw new Error(`${kind} attachment must have either url or data`);
  }
  return { kind, mimeType: params.mimeType, name: params.name, url: params.url, data, format: params.format };
}

export const makeImageAttachment = (params: AttachmentParams): Attachment => buildAttachment('image', params);
export const makeDocumentAttachment = (params: AttachmentParams): Attachment => buildAttachment('document', params);
export const makeFileAttachment = (params: AttachmentParams): Attachment => buildAttachment('file', params);
