import { z } from 'zod';
import { LLMClient, createUserMessage } from '@framework';

import { AgentsConfig } from '../../../agents/config.js';
import { logLLMCallStart, logLLMError } from '../../../agents/agentLogger.js';
import { parseAgentOutput } from '../../../services/agents/utils.js';
import { logger } from '../../../utils/logger.js';
import { orgLLMCredentialService } from '../../../services/orgLLMCredentialService.js';
import type { CategoryConfig, GeneratedTag } from '../../types.js';
import { validateGeneratedTags } from '../validate.js';
import { LlmRawOutputSchema } from './schema.js';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

const AGENT_NAME = 'TagGeneratorLLM';

function renderCategoryBlock(name: string, category: CategoryConfig): string {
  const instructions = category.prompt ?? 'Use your judgement.';
  const allowedTags = category.tags && category.tags.length > 0 ? category.tags.join(', ') : 'no fixed list';
  const blacklistedTags = category.blacklist && category.blacklist.length > 0 ? category.blacklist.join(', ') : 'none';
  const maxTags = category.count !== undefined ? String(category.count) : 'no limit';
  const allowNewTags = category.is_new_tag_allowed ? 'yes' : 'no';

  return `Category "${name}":
- Instructions: ${instructions}
- Allowed tags: ${allowedTags}
- Blacklisted tags: ${blacklistedTags}
- Max tags for this category: ${maxTags}
- You MAY invent new tags for this category: ${allowNewTags}`;
}

function buildSystemPrompt(categories: Record<string, CategoryConfig>): string {
  const categoryBlocks = Object.entries(categories)
    .map(([name, category]) => renderCategoryBlock(name, category))
    .join('\n\n');

  return `You are a tagging assistant. The CONTEXT below is an email thread. It may contain one or more emails labeled as follows:
- [Previous conversation]: earlier emails in the thread, provided as background context only
- [Latest email]: the most recent email — this is what you must base your tagging decision on

Base your tags on the [Latest email]. Use [Previous conversation] emails only to understand background context (e.g. who the customer is, what the original issue was).

HOW TO DECIDE TAGS, FOR EACH CATEGORY BELOW:
1. Read the [Latest email] and judge whether this category is relevant to it. If it is NOT relevant, skip this category entirely - do not output any tag for it.
2. If relevant, look at "Allowed tags" - this is the existing list of tags already defined for this category. Prefer reusing one of these if it fits.
3. Only if none of the allowed tags fit, AND "You MAY invent new tags for this category" is "yes", you may create a new tag following the naming format below. If it says "no", you MUST pick only from "Allowed tags" - if none fit, skip this category.
4. Never output a tag listed under "Blacklisted tags".
5. Never output more than "Max tags for this category" tags for that category - pick the best matches if more could apply.

CATEGORIES:

${categoryBlocks}

OUTPUT FORMAT:
Return JSON only, with no extra text and no markdown, in exactly this shape:
{"tags":[{"category":"category-name","tag":"tag-name","reason":"short reason based on context"}]}

Tag and category names MUST be lowercase, hyphen-separated words only (e.g. "billing-issue", "high-priority"). Do not use spaces, underscores, or uppercase letters.
Reason MUST be a concise plain-language explanation grounded in the context.

Only use category names listed above. If no category applies, return {"tags":[]}.`;
}

function buildUserPrompt(context: string): string {
  return `--- CONTEXT ---
${context}
--- END OF CONTEXT ---`;
}

export async function generateLlmTags(
  context: string,
  categories: Record<string, CategoryConfig>,
  workspaceId: string,
): Promise<GeneratedTag[]> {
  const cacConfig = await AgentsConfig.fetch();
  const modelName = cacConfig.tagGenerationModelName;
  const credential = await orgLLMCredentialService.getCredentialByWorkspaceId(
    workspaceId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );

  if (!credential) {
    throw new Error(`No active DEFAULT LiteLLM service account credential for workspace ${workspaceId}`);
  }

  const llmClient = new LLMClient({
    provider: {
      type: 'litellm',
      config: {
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
      },
    },
    defaultModel: modelName,
    retry: { maxAttempts: 5, baseDelay: 2000, maxDelay: 16000, exponentialBackoff: true },
  });

  logLLMCallStart(AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');

  let responseContent: string;
  try {
    const response = await llmClient.generate({
      messages: [createUserMessage(buildUserPrompt(context))],
      systemPrompt: buildSystemPrompt(categories),
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    });
    responseContent = response.content;
  } catch (err) {
    logLLMError(AGENT_NAME, err);
    throw new Error(`LLM tag generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: z.infer<typeof LlmRawOutputSchema>;
  try {
    parsed = parseAgentOutput(responseContent, LlmRawOutputSchema);
  } catch (err) {
    throw new Error(`LLM tag output parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const tags = validateGeneratedTags(parsed.tags, categories);
  logger.info(`[${AGENT_NAME}] Success: generated ${tags.length} tag(s)`);
  return tags;
}
