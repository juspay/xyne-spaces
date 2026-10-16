import { z } from 'zod';
import { LLMClient, createUserMessage } from 'agentic-framework';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';
import { config as envConfig } from '@/config/env';
import { logger } from '@/utils/logger';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import {
  ACTIVITY_LABEL_CRITERIA,
  activityInstructionsFor,
  type ActivityInputKind,
  type ActivityLabel,
} from '@/services/activity/activityClassificationXor';

/**
 * Activity classification by the LLM — the second step of XOR → LLM → the activity's
 * fallback, used when XOR has no answer or is unsure.
 *
 * The prompt lives here, built from the same label rules XOR is given; the Langfuse prompts
 * this classifier once used are gone. Never throws: any failure comes back as `ok: false`
 * and the caller files the activity under its fallback label.
 */

const TAG = '[ACTIVITY][LLM]';
const MODEL = envConfig.activityClassification?.model ?? 'glm-latest';

const OutputSchema = z.object({
  classification: z.enum(['ACTIONABLE', 'FYI', 'SKIP']),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

export type LlmActivityResult =
  | { ok: true; classification: ActivityLabel; confidence: number | null }
  | { ok: false; reason: string };

const buildPrompt = (input: Record<string, unknown>, kind: ActivityInputKind, labels: ActivityLabel[]): string =>
  [
    activityInstructionsFor(kind),
    '',
    'Labels:',
    ...labels.map(label => `- ${label}: ${ACTIVITY_LABEL_CRITERIA[label]}`),
    '',
    'Return ONLY a JSON object, with no other text:',
    `{ "classification": ${labels.map(label => `"${label}"`).join(' | ')}, "confidence": number between 0 and 1 }`,
    '',
    'Notification:',
    JSON.stringify(input),
  ].join('\n');

const parse = (content: string): z.infer<typeof OutputSchema> | null => {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = OutputSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export async function classifyActivityWithLlm(
  input: Record<string, unknown>,
  options: { allowSkip: boolean; kind: ActivityInputKind; logId: string; workspaceId: string | null },
): Promise<LlmActivityResult> {
  try {
    const credential = await orgLLMCredentialService.getCredentialByWorkspaceId(
      options.workspaceId,
      OrgLLMServiceAccountPurpose.ACTIVITY_CLASSIFICATION,
    );
    if (!credential) return { ok: false, reason: 'no_credential' };

    const model = credential.defaultModel ?? MODEL;
    const client = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: credential.apiKey,
          // The provider appends /chat/completions; a stored trailing slash would make it '//…' (404).
          baseUrl: credential.baseUrl.replace(/\/+$/, ''),
          timeout: envConfig.llm?.requestTimeoutMs,
          customHeaders: { 'x-litellm-disable-logging': 'true' },
        },
      },
      defaultModel: model,
      temperature: 0.2,
    });

    const labels: ActivityLabel[] = options.allowSkip ? ['ACTIONABLE', 'FYI', 'SKIP'] : ['ACTIONABLE', 'FYI'];
    const response = await client.generate({
      messages: [createUserMessage(buildPrompt(input, options.kind, labels))],
      model,
    });
    const parsed = parse(response.content ?? '');
    if (!parsed) return { ok: false, reason: 'parse_failed' };
    // SKIP was not offered, so it cannot be taken.
    const classification: ActivityLabel =
      parsed.classification === 'SKIP' && !options.allowSkip ? 'FYI' : parsed.classification;

    logger.info(
      `${TAG} ${options.logId}  llm decided  [${model}]  classification ${classification}` +
        (parsed.confidence !== undefined ? `  (${parsed.confidence.toFixed(2)})` : ''),
      { logId: options.logId, kind: options.kind, classification, confidence: parsed.confidence ?? null, model },
    );
    return { ok: true, classification, confidence: parsed.confidence ?? null };
  } catch (error) {
    logger.warn(`${TAG} ${options.logId}  llm failed`, {
      logId: options.logId,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: error instanceof Error ? error.name : 'unknown' };
  }
}
