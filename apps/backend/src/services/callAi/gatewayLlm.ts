import { randomUUID } from 'crypto';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';

/**
 * Non-Claw call AI through the egress transit proxy, so the reply is never plaintext here:
 * prompt → workspace DEK → CEK for the proxy (encryptBatch + transformResponse), which with
 * `llmTarget` also has the encryption service build and seal the LiteLLM endpoint and key for the
 * proxy. The chat-completions request and answer are built and read here; the proxy's
 * `POST /llm` only decrypts, posts the request to that endpoint and returns the answer with
 * every string encrypted (CEK). transformRequest turns the reply into workspace-DEK ciphertext
 * (apps manifest rule `POST /internal/call-ai/result`) to store as-is.
 *
 * runLlmOnGatewayForPlaintext is the same call for outputs the backend has to process (the
 * detailed-summary canvas): the reply is decrypted here instead.
 *
 * Logs (`call_ai_gateway_*`) share one `gatewayCallId` per call, also sent to the proxy as
 * `X-Call-Ai-Id` and printed in its log lines. They carry sizes, key ids, statuses and timings,
 * never prompt or reply text.
 */

const LLM_TIMEOUT_MS = 16 * 60_000;
/** Workspace-DEK ciphertext; never transit ciphertext (`tk-`) or plaintext. */
const DEK_CIPHERTEXT = /^ENC:v\d+\|(?!tk-)[^|]+\|/;
const LLM_PATH = '/chat/completions';

export function isGatewayLlmEnabled(): boolean {
  return Boolean(config.internal.transitProxyEgressUrl) && config.enc.enableDbEncryption;
}

export interface GatewayLlmTask {
  /** For logs only. */
  operation: string;
  /** For logs only. */
  callId: string;
  userPrompt: string;
  systemPrompt?: string;
  model: string;
  /** The call's workspace: the prompt goes out (and the reply comes back) under its DEK. */
  workspaceId: string;
  abortSignal?: AbortSignal;
}

interface GatewayRun {
  id: string;
  started: number;
  log: (event: string, fields?: Record<string, unknown>) => void;
  /** Logs `call_ai_gateway_failed` and returns the error to throw. */
  fail: (step: string, message: string, fields?: Record<string, unknown>) => Error;
}

const proxyClient = () => ({ role: 'egress', version: config.internal.transitProxyEgressKeyVersion }) as const;

/** `ENC:v1|<keyId>|…` → `<keyId>`; never the ciphertext itself. */
function keyIdOf(value: unknown): string {
  if (typeof value !== 'string') return typeof value;
  return /^ENC:v\d+\|([^|]+)\|/.exec(value)?.[1] ?? 'not_ciphertext';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The reply as workspace-DEK ciphertext. Throws on any failure; nothing it throws holds prompt or reply text. */
export async function runLlmOnGateway(task: GatewayLlmTask): Promise<string> {
  const run = begin(task, 'dek');
  const content = await callGateway(task, run);

  // A variable, not a literal: the public and private TransformRequestInput differ in `environment`.
  const input = {
    proxyClient: proxyClient(),
    method: 'POST',
    path: '/internal/call-ai/result',
    body: { content },
    environment: config.env === 'production' ? 'production' : 'development',
    entityId: task.workspaceId,
    entityType: 'WORKSPACE',
  };
  const stepStarted = Date.now();
  let stored: unknown;
  try {
    const { body } = await getEncryptionProvider().transformRequest(input);
    stored = (body as { content?: unknown }).content;
  } catch (error) {
    throw run.fail('reply_to_dek', errorMessage(error));
  }
  if (typeof stored !== 'string' || !DEK_CIPHERTEXT.test(stored)) {
    throw run.fail('reply_to_dek', 'Encryption service did not return workspace-DEK ciphertext', {
      replyKeyId: keyIdOf(stored),
      hint: 'is the apps manifest rule POST /internal/call-ai/result active (CLIENT_MANIFEST_VERSIONS apps=2)?',
    });
  }
  run.log('call_ai_gateway_reply_sealed', {
    replyDekKeyId: keyIdOf(stored),
    replyCiphertextLength: stored.length,
    ms: Date.now() - stepStarted,
  });
  run.log('call_ai_gateway_completed', { totalMs: Date.now() - run.started });
  return stored;
}

/** The reply as plaintext, for outputs the backend processes. Throws like runLlmOnGateway. */
export async function runLlmOnGatewayForPlaintext(task: GatewayLlmTask): Promise<string> {
  const run = begin(task, 'plaintext');
  const content = await callGateway(task, run);
  const stepStarted = Date.now();
  let plain: unknown;
  try {
    ({ content: plain } = await getEncryptionProvider().decryptRequest({ content }, { proxyClient: proxyClient() }));
  } catch (error) {
    throw run.fail('reply_decrypt', errorMessage(error));
  }
  if (typeof plain !== 'string' || plain.trim() === '') {
    throw run.fail('reply_decrypt', 'Gateway returned no content', { replyKeyId: keyIdOf(plain) });
  }
  run.log('call_ai_gateway_reply_decrypted', { replyChars: plain.length, ms: Date.now() - stepStarted });
  run.log('call_ai_gateway_completed', { totalMs: Date.now() - run.started });
  return plain;
}

function begin(task: GatewayLlmTask, replyAs: 'dek' | 'plaintext'): GatewayRun {
  const id = `${task.callId}:${task.operation}:${randomUUID().slice(0, 8)}`;
  const base = { gatewayCallId: id, operation: task.operation, workspaceId: task.workspaceId, replyAs };
  const started = Date.now();
  return {
    id,
    started,
    log: (event, fields = {}) => logger.info(`[${task.callId}] ${event}`, { ...base, ...fields }),
    fail: (step, message, fields = {}) => {
      logger.error(`[${task.callId}] call_ai_gateway_failed`, {
        ...base,
        step,
        error: message,
        totalMs: Date.now() - started,
        ...fields,
      });
      return new Error(`${step}: ${message}`);
    },
  };
}

/** The proxy's `POST /llm`; the reply content as the proxy encrypted it (CEK). */
async function callGateway(task: GatewayLlmTask, run: GatewayRun): Promise<string> {
  const provider = getEncryptionProvider();
  const messages = [
    ...(task.systemPrompt ? [{ role: 'system', content: task.systemPrompt }] : []),
    { role: 'user', content: task.userPrompt },
  ];
  run.log('call_ai_gateway_started', {
    model: task.model,
    messages: messages.length,
    promptChars: messages.reduce((n, m) => n + m.content.length, 0),
    egressUrl: config.internal.transitProxyEgressUrl,
    egressKeyVersion: config.internal.transitProxyEgressKeyVersion,
  });

  // 1. Prompt → workspace DEK.
  let stepStarted = Date.now();
  let sealed: string[];
  try {
    sealed = await provider.encryptBatch(
      messages.map((m) => ({ value: m.content, entityId: task.workspaceId, entityType: 'WORKSPACE' })),
    );
  } catch (error) {
    throw run.fail('prompt_to_dek', errorMessage(error));
  }
  const dekKeyIds = [...new Set(sealed.map(keyIdOf))];
  run.log('call_ai_gateway_prompt_dek_encrypted', { dekKeyIds, ms: Date.now() - stepStarted });

  // 2. DEK → CEK for the proxy, and the sealed LiteLLM target.
  stepStarted = Date.now();
  let forProxy: { messages: { role: string; content: string }[] };
  let target: string | undefined;
  try {
    ({ body: forProxy, llmTarget: target } = await provider.transformResponse(
      { messages: messages.map((m, i) => ({ role: m.role, content: sealed[i] })) },
      { proxyClient: proxyClient(), llmTarget: { name: 'calllitellm', path: LLM_PATH } },
    ));
  } catch (error) {
    throw run.fail('prompt_to_cek', errorMessage(error));
  }
  if (!target) {
    throw run.fail('prompt_to_cek', 'Encryption service returned no LLM target', {
      hint: 'is API client encryption on in the backend, and LITELLM_TARGET set in the encryption service?',
    });
  }
  const cekKeyIds = [...new Set(forProxy.messages.map((m) => keyIdOf(m.content)))];
  if (cekKeyIds.some((keyId) => keyId === 'not_ciphertext' || dekKeyIds.includes(keyId))) {
    throw run.fail('prompt_to_cek', 'Messages were not converted to transit ciphertext', { cekKeyIds });
  }
  run.log('call_ai_gateway_prompt_cek_ready', {
    cekKeyIds,
    targetKeyId: keyIdOf(target),
    llmPath: LLM_PATH,
    ms: Date.now() - stepStarted,
  });

  // 3. The proxy's POST /llm.
  stepStarted = Date.now();
  const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.internal.transitProxyEgressUrl}/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Call-Ai-Id': run.id },
      body: JSON.stringify({ target, request: { model: task.model, stream: false, ...forProxy } }),
      redirect: 'manual',
      signal: task.abortSignal ? AbortSignal.any([task.abortSignal, timeout]) : timeout,
    });
  } catch (error) {
    throw run.fail('gateway_request', errorMessage(error), { ms: Date.now() - stepStarted });
  }
  if (!response.ok) {
    // The proxy's own errors are short reasons; an LLM error body comes back encrypted.
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw run.fail('gateway_response', `Egress proxy answered ${response.status}`, {
      status: response.status,
      detail,
      ms: Date.now() - stepStarted,
    });
  }
  const answer = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = answer.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || keyIdOf(content) === 'not_ciphertext') {
    throw run.fail('gateway_response', 'Reply content is missing or not transit ciphertext', {
      choices: answer.choices?.length ?? 0,
      replyKeyId: keyIdOf(content),
    });
  }
  run.log('call_ai_gateway_llm_answered', {
    status: response.status,
    choices: answer.choices?.length ?? 0,
    replyKeyId: keyIdOf(content),
    promptTokens: answer.usage?.prompt_tokens,
    completionTokens: answer.usage?.completion_tokens,
    ms: Date.now() - stepStarted,
  });
  return content;
}
