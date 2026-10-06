import { z } from 'zod';
import { createUserMessage } from '@framework';
import { AgentsConfig } from '../config.js';
import { resolveOrgLLMClient } from '../llmClient.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agentLogger.js';
import { parseAgentOutput } from '@/services/agents/utils';

const AGENT_NAME = 'ReleaseInsights';

export interface ReleaseInsightsContext {
  readonly userId: string;
  readonly projectId: string | null;
}

export interface ReleaseInsightsInput {
  release: { xyneId: string; title: string; description: string | null; status: string; version: string | null };
  stats: {
    devTicketCount: number;
    environmentVariableCount: number;
    migrationFileCount: number;
    repositoryCount: number;
    serviceNames: string[];
    hotfixCount: number;
    qaAssigned: number;
    potPresent: number;
    prCount: number;
    contributors: { name: string; ticketCount: number }[];
  };
  devTickets: { title: string; type: string; status: string; devOwner: string; qaOwner: string; changes: string; hasPr: boolean }[];
  prs: { title: string; description: string; hasPot: boolean }[];
  migrations: { service: string; file: string }[];
  environmentChanges: { service: string; description: string }[];
}

export interface ReleaseInsightsLlmOutput {
  summary: string;
  composition: { label: string; percent: number }[];
  risk: { level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] };
  qualityGaps: string[];
  watchItems: string[];
}

const OutputSchema = z.object({
  summary: z.string(),
  composition: z
    .array(z.object({ label: z.string(), percent: z.number() }))
    .transform(a => a.slice(0, 8)),
  risk: z.object({
    level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    reasons: z.array(z.string()).transform(a => a.slice(0, 6)),
  }),
  qualityGaps: z.array(z.string()).transform(a => a.slice(0, 10)),
  watchItems: z.array(z.string()).transform(a => a.slice(0, 10)),
});

const SYSTEM_INSTRUCTIONS = `You are a release analyst. You are given structured data about ONE software release (its dev tickets, pull requests, env/migration changes, and precomputed stats). Produce concise, manager-facing insights.

Return ONLY valid JSON with this exact schema:
{
  "summary": string,
  "composition": [ { "label": string, "percent": number } ],
  "risk": { "level": "LOW" | "MEDIUM" | "HIGH", "reasons": string[] },
  "qualityGaps": string[],
  "watchItems": string[]
}

Guidance:
- summary: 2-3 sentences in plain English — what this release ships and its overall risk. No fluff.
- composition: classify the work into a few buckets (e.g. Feature, Fix, Refactor, Infra, Docs) as PERCENTAGES that sum to ~100. Base it on the dev-ticket and PR titles/descriptions.
- risk.level: weigh migration count (schema/irreversible migrations are higher risk), env-var changes, number of services and repositories touched, and whether hotfixes are present. risk.reasons: 2-4 short, specific bullets.
- qualityGaps: name specific tickets that lack a QA owner or proof-of-testing (POT), or are not in a tested stage. Empty array if none.
- watchItems: 2-4 things worth a closer look (irreversible migration, a large/broad PR, a secret/env change, a hotfix to confirm). Empty array if none.
- Use only the provided data. Do not invent tickets, people, or files.
- Output JSON only, no extra text, no reasoning, no thinking tags.`;

function buildPrompt(input: ReleaseInsightsInput): string {
  return `Analyze this release and return the insights JSON.

<release>
${JSON.stringify(input, null, 2)}
</release>`;
}

export async function generateReleaseInsights(
  input: ReleaseInsightsInput,
  context: ReleaseInsightsContext,
  agentsConfig?: AgentsConfig,
): Promise<ReleaseInsightsLlmOutput> {
  const cacConfig = agentsConfig ?? (await AgentsConfig.fetch());
  const modelName = cacConfig.releaseAiModelName;
  const llmClient = await resolveOrgLLMClient({
    modelName,
    userId: context.userId,
    projectId: context.projectId,
  });

  const prompt = buildPrompt(input);

  logLLMCallStart(AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');

  try {
    const response = await llmClient.generate({
      messages: [createUserMessage(prompt)],
      systemPrompt: SYSTEM_INSTRUCTIONS,
      parameters: {
        temperature: 0.2,
      },
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    });

    logLLMSuccess(AGENT_NAME, response.content);
    return parseAgentOutput(response.content, OutputSchema);
  } catch (error) {
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}
