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
import { parseAgentOutput } from '@/services/agents/utils';
import type { TeamIntelligenceAggregationResult } from '@/services/teamIntelligenceReport/types';

const TEAM_INTELLIGENCE_AGENT_NAME = 'TeamIntelligenceReporter';

const TeamIntelligenceReportSchema = z.object({
  title: z.string(),
  overview: z.string(),
  perPersonActivity: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      summary: z.string(),
      themes: z.array(z.string()),
      workloadSignals: z.array(z.string()),
    })
  ),
  teamDistribution: z.object({
    summary: z.string(),
    hotspots: z.array(z.string()),
    gaps: z.array(z.string()),
  }),
  overlaps: z.array(
    z.object({
      people: z.array(z.string()).min(2).max(2),
      summary: z.string(),
      evidence: z.array(z.string()),
      riskLevel: z.enum(['low', 'medium', 'high']),
    })
  ),
  conflicts: z.array(
    z.object({
      summary: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
      evidence: z.array(z.string()),
    })
  ),
  markdown: z.string(),
});

export type TeamIntelligenceReportOutput = z.infer<typeof TeamIntelligenceReportSchema>;

type TeamIntelligenceContext = {
  orgId: string;
};

const teamIntelligenceAgent: Agent<TeamIntelligenceContext, string> = {
  name: TEAM_INTELLIGENCE_AGENT_NAME,
  instructions: () => `You are an internal workspace intelligence analyst.

You receive aggregated team context from Gmail and optional transcript sources. Produce a manager-grade structured report.

Return ONLY JSON with this exact shape:
{
  "title": string,
  "overview": string,
  "perPersonActivity": [
    {
      "userId": string,
      "name": string,
      "summary": string,
      "themes": string[],
      "workloadSignals": string[]
    }
  ],
  "teamDistribution": {
    "summary": string,
    "hotspots": string[],
    "gaps": string[]
  },
  "overlaps": [
    {
      "people": [string, string],
      "summary": string,
      "evidence": string[],
      "riskLevel": "low" | "medium" | "high"
    }
  ],
  "conflicts": [
    {
      "summary": string,
      "severity": "low" | "medium" | "high",
      "evidence": string[]
    }
  ],
  "markdown": string
}

Rules:
- Ground every insight in the supplied evidence only.
- Be explicit when data is sparse.
- Prefer actionable manager language over generic summaries.
- Overlaps should focus on semantically similar tracks, duplicated initiative discovery, or likely redundant exploration.
- Conflicts should be conservative; only call out conflicts/redundancy when the evidence is strong enough.
- markdown must be a concise but readable manager report with sections for Overview, Per Person, Distribution, Overlaps, and Conflicts / Risks.
- JSON only. No prose outside JSON.`,
  modelConfig: {
    temperature: 0.2,
  },
};

const teamIntelligenceAgentRegistry = new Map<string, Agent<TeamIntelligenceContext, any>>([
  [TEAM_INTELLIGENCE_AGENT_NAME, teamIntelligenceAgent],
]);

const createModelProvider = () => {
  if (!config.litellm.baseUrl || !config.litellm.apiKey) {
    throw new Error('LiteLLM configuration is missing for team intelligence reporting.');
  }

  return makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);
};

const buildPrompt = (input: TeamIntelligenceAggregationResult): string => {
  return `Generate a manager-level intelligence report for the following org-scoped team context.

<report_input>
${JSON.stringify(input, null, 2)}
</report_input>`;
};

export async function generateTeamIntelligenceReport(
  input: TeamIntelligenceAggregationResult
): Promise<TeamIntelligenceReportOutput> {
  const modelProvider = createModelProvider();
  const runConfig: RunConfig<TeamIntelligenceContext> = {
    agentRegistry: teamIntelligenceAgentRegistry,
    modelProvider: modelProvider as RunConfig<TeamIntelligenceContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: config.workflow.defaultModelName,
  };

  const initialState: RunState<TeamIntelligenceContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: buildPrompt(input),
      },
    ],
    currentAgentName: TEAM_INTELLIGENCE_AGENT_NAME,
    context: {
      orgId: input.orgId,
    },
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status !== 'completed') {
    if (result.outcome.status === 'error') {
      throw new Error(`Team intelligence report generation failed: ${result.outcome.error._tag}`);
    }

    throw new Error('Team intelligence report generation was interrupted.');
  }

  const rawOutput =
    typeof result.outcome.output === 'string'
      ? result.outcome.output
      : JSON.stringify(result.outcome.output);

  return parseAgentOutput(rawOutput, TeamIntelligenceReportSchema);
}
