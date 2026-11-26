import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';

/**
 * Non-Claw call AI through the egress transit proxy, so the reply is never plaintext here:
 * prompt → workspace DEK → CEK for the proxy (encryptBatch + transformResponse), the proxy's
 * `POST /llm` runs it and encrypts the reply (CEK), and transformRequest turns that into
 * workspace-DEK ciphertext (apps manifest rule `POST /internal/call-ai/result`) to store as-is.
 */

const LLM_TIMEOUT_MS = 16 * 60_000;
/** Workspace-DEK ciphertext; never transit ciphertext (`tk-`) or plaintext. */
const DEK_CIPHERTEXT = /^ENC:v\d+\|(?!tk-)[^|]+\|/;

export function isGatewayLlmEnabled(): boolean {
  return Boolean(config.internal.transitProxyEgressUrl) && config.enc.enableDbEncryption;
}

export interface GatewayLlmTask {
  operation: string;
  userPrompt: string;
  systemPrompt?: string;
  model: string;
  /** The call's workspace: the reply comes back under its DEK. */
  workspaceId: string;
  /** `title`: the proxy keeps the first line, unquoted, at most 100 characters. */
  format?: 'text' | 'title';
}

/** The reply as workspace-DEK ciphertext. Throws on any failure; nothing it throws holds prompt or reply text. */
export async function runLlmOnGateway(task: GatewayLlmTask): Promise<string> {
  const provider = getEncryptionProvider();
  const proxyClient = { role: 'egress', version: config.internal.transitProxyEgressKeyVersion } as const;
  const owner = { entityId: task.workspaceId, entityType: 'WORKSPACE' };

  const messages = [
    ...(task.systemPrompt ? [{ role: 'system', content: task.systemPrompt }] : []),
    { role: 'user', content: task.userPrompt },
  ];
  const sealed = await provider.encryptBatch(messages.map((m) => ({ value: m.content, ...owner })));
  const { body: forProxy } = await provider.transformResponse(
    { messages: messages.map((m, i) => ({ role: m.role, content: sealed[i] })) },
    { proxyClient },
  );

  const response = await fetch(`${config.internal.transitProxyEgressUrl}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: task.operation, model: task.model, format: task.format ?? 'text', ...forProxy }),
    redirect: 'manual',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Egress proxy answered ${response.status}`);
  }
  const { content } = (await response.json()) as { content?: unknown };

  // A variable, not a literal: the public and private TransformRequestInput differ in `environment`.
  const input = {
    proxyClient,
    method: 'POST',
    path: '/internal/call-ai/result',
    body: { content },
    environment: config.env === 'production' ? 'production' : 'development',
    ...owner,
  };
  const { body } = await provider.transformRequest(input);
  const stored = (body as { content?: unknown }).content;
  if (typeof stored !== 'string' || !DEK_CIPHERTEXT.test(stored)) {
    throw new Error('Encryption service did not return workspace-DEK ciphertext');
  }
  return stored;
}
