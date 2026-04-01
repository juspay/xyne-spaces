import { z } from 'zod';
import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
} from '@xynehq/jaf';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { parseAgentOutput } from '@/services/agents/utils';

const entityTagLogger = logger.child({ module: 'entity-tag-extractor' });

export interface ExtractedEntityTags {
  people: string[];
  productSpecifications: string[];
  merchants: string[];
}

type EntityTagContext = {
  source?: string;
};

const ENTITY_TAG_AGENT_NAME = 'EntityTagExtractor';

const EMPTY_ENTITY_TAGS: ExtractedEntityTags = {
  people: [],
  productSpecifications: [],
  merchants: [],
};

const ExtractedEntityTagsSchema = z.object({
  people: z.array(z.string()).default([]),
  productSpecifications: z.array(z.string()).default([]),
  merchants: z.array(z.string()).default([]),
});

const ENTITY_TAG_SYSTEM_PROMPT = `Extract entity tags from the provided email text.
Return only JSON with this exact shape:
{
  "people": [],
  "productSpecifications": [],
  "merchants": []
}

Rules:
- people: full names of people only
- productSpecifications: product names, model numbers, SKU-like identifiers, and specific product/spec references
- merchants: merchant, company, brand, seller, and business names
- deduplicate values
- use concise canonical strings
- do not invent values
- if no values exist for a field, return an empty array`;

const entityTagAgent: Agent<EntityTagContext, string> = {
  name: ENTITY_TAG_AGENT_NAME,
  instructions: () => ENTITY_TAG_SYSTEM_PROMPT,
  modelConfig: {
    temperature: 0,
  },
};

const entityTagAgentRegistry = new Map<string, Agent<EntityTagContext, any>>([
  [ENTITY_TAG_AGENT_NAME, entityTagAgent],
]);

const normalizeTagList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
};

const normalizeExtractedEntityTags = (
  tags: Partial<ExtractedEntityTags> | undefined | null
): ExtractedEntityTags => {
  return {
    people: normalizeTagList(tags?.people || []),
    productSpecifications: normalizeTagList(tags?.productSpecifications || []),
    merchants: normalizeTagList(tags?.merchants || []),
  };
};

export const isExtractedEntityTagsEmpty = (
  tags: Partial<ExtractedEntityTags> | undefined | null
): boolean => {
  const normalized = normalizeExtractedEntityTags(tags);
  return (
    normalized.people.length === 0 &&
    normalized.productSpecifications.length === 0 &&
    normalized.merchants.length === 0
  );
};

export const mergeExtractedEntityTags = (
  existing: Partial<ExtractedEntityTags> | undefined | null,
  incoming: Partial<ExtractedEntityTags> | undefined | null
): ExtractedEntityTags => {
  return normalizeExtractedEntityTags({
    people: [...(existing?.people || []), ...(incoming?.people || [])],
    productSpecifications: [
      ...(existing?.productSpecifications || []),
      ...(incoming?.productSpecifications || []),
    ],
    merchants: [...(existing?.merchants || []), ...(incoming?.merchants || [])],
  });
};

export const coerceExtractedEntityTags = (
  value: unknown
): ExtractedEntityTags => {
  const parsed = ExtractedEntityTagsSchema.safeParse(value);
  if (!parsed.success) {
    return EMPTY_ENTITY_TAGS;
  }

  return normalizeExtractedEntityTags(parsed.data);
};

const createModelProvider = () => {
  if (!config.litellm.baseUrl || !config.litellm.apiKey) {
    throw new Error('LiteLLM configuration is missing for entity tag extraction.');
  }

  return makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);
};

export const extractEntityTags = async (
  text: string
): Promise<ExtractedEntityTags> => {
  if (!config.googleMail.entityTagExtractionEnabled) {
    return EMPTY_ENTITY_TAGS;
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return EMPTY_ENTITY_TAGS;
  }

  const modelProvider = createModelProvider();

  const runConfig: RunConfig<EntityTagContext> = {
    agentRegistry: entityTagAgentRegistry,
    modelProvider: modelProvider as RunConfig<EntityTagContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: config.workflow.defaultModelName,
  };

  const initialState: RunState<EntityTagContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: trimmedText,
      },
    ],
    currentAgentName: ENTITY_TAG_AGENT_NAME,
    context: {
      source: 'gmail',
    },
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status !== 'completed') {
    if (result.outcome.status === 'error') {
      throw new Error(`Entity tag extraction failed: ${result.outcome.error._tag}`);
    }

    throw new Error('Entity tag extraction was interrupted.');
  }

  const rawOutput =
    typeof result.outcome.output === 'string'
      ? result.outcome.output
      : JSON.stringify(result.outcome.output);

  try {
    return normalizeExtractedEntityTags(
      parseAgentOutput(rawOutput, ExtractedEntityTagsSchema)
    );
  } catch (error) {
    entityTagLogger.warn('Entity tag extraction returned invalid response', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};
