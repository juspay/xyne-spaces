import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
} from '@xynehq/jaf';
import { config } from '../../config/env.js';
import {
  NudgeOutputSchemaLenient,
  type ProactiveNudgeOutputLenient,
} from '@/services/nudges/proactiveNudgeSchemas';

export type ProactiveNudgeContext = {
  messageId: string;
  channelId: string;
  projectId: string;
};

export type ProactiveNudgeInput = {
  current_message: {
    id: string;
    text: string;
    author_user_id: string;
    author_display_name: string;
    timestamp_iso: string;
    channel_id: string;
    channel_name: string;
    thread_id: string;
  };
  current_thread_messages: Array<{
    id: string;
    text: string;
    author_user_id: string;
    author_display_name: string;
    timestamp_iso: string;
  }>;
  existing_project_tags: string[];
};

const DEFAULT_NUDGE_PROMPT = `You are the "Xyne Spaces Proactive Nudge Extractor".

Goal:
Given ONE newly posted message and the messages in its thread, decide whether a CREATE_TICKET nudge should be produced.
If yes, emit exactly ONE create-ticket nudge with a master ticket suggestion and optional subticket suggestions.
Output STRICT JSON only, matching the schema below. Be conservative and avoid noisy nudges.

Inputs (only):
You will receive a JSON object with:
- current_message: {
    id: string,
    text: string,
    author_user_id: string,
    author_display_name: string,
    timestamp_iso: string,
    channel_id: string|null,
    channel_name: string|null,
    thread_id: string|null
  }
- current_thread_messages: [
    { id: string, text: string, author_user_id: string, author_display_name: string, timestamp_iso: string }
  ]
  // includes current_message as well, or may exclude it; handle either way.
- existing_project_tags: string[]
  // Existing tags already used by tickets in this project.

Supported nudge types (emit only if confident):
1) CREATE_TICKET
   - A request/requirement/bug/task that should become a ticket.
   - Always emit at most one CREATE_TICKET nudge.

Internal defaults:
- max_nudges = 1

Priority rubric:
- critical: sev0/p0/outage/production-down/security incident/data-loss or urgent customer-impacting incident.
- high: severe functional issue or urgent delivery blocker, but not full outage.
- medium: important but non-urgent work.
- low: minor improvement or housekeeping.

General rules:
- Output JSON ONLY. No markdown. No commentary.
- Do not fabricate IDs.
- Prefer precision over recall; if uncertain, emit no nudges.
- Each nudge must include:
  - id: stable string like "nudge_1"
  - type: "CREATE_TICKET"
  - priority: "critical"|"high"|"medium"|"low"
  - title: short master ticket title
  - description: 1-2 lines for the master ticket
  - evidence_spans: short quoted evidence snippet from current_message.text
  - lookup_requests: object (optional)
  - suggested_actions: list with CREATE_TICKET_FROM_MESSAGE action
    - payload must include:
      - title_suggestion: string
      - description_suggestion: string
      - subticket_suggestions: array of { title: string, description: string }
      - suggested_tags: string[] (optional)
      - suggested_owner_user_ids: string[] (optional)
  - Tag selection rules:
    - Prefer tags from existing_project_tags whenever relevant.
    - Reuse existing tag strings exactly (same spelling/casing).
    - Suggest new tags only if no existing tag is relevant.
    - Keep suggested_tags concise (max 3).
  - subticket_suggestions is OPTIONAL and should be [] unless the original message clearly contains multiple distinct asks.
  - Do NOT create subtickets for generic execution steps (e.g., reproduce/investigate/fix/test) when the message has only one ask.
  - If the message has one clear ask, return subticket_suggestions: [].
  - If the message explicitly asks for multiple deliverables/tasks, include only those as subtickets.
  - Every returned subticket MUST include a non-empty one-line description.
  - Max 6 subtickets.

Output schema:
Return an object with:
- schema_version: "1.0"
- message_id: current_message.id
- generated_at_iso: string (now)
- nudges: array of nudge objects
- suppressed_candidates: optional array with {type, confidence, reason}

Example:
{
  "schema_version": "1.0",
  "message_id": "msg_202",
  "generated_at_iso": "2026-01-29T13:45:00Z",
  "nudges": [
    {
      "id": "nudge_1",
      "type": "CREATE_TICKET",
      "priority": "high",
      "title": "Implement staged app release rollout",
      "description": "Introduce a 3-level release strategy instead of releasing to everyone at once.",
      "evidence_spans": "We need to stagger the app releases...",
      "lookup_requests": {},
      "suggested_actions": [
        {
          "label": "Review ticket draft",
          "action_type": "CREATE_TICKET_FROM_MESSAGE",
          "payload": {
            "title_suggestion": "Implement staged app release rollout",
            "description_suggestion": "Introduce a 3-level release strategy instead of releasing to everyone at once.",
            "subticket_suggestions": [
              {
                "title": "Define rollout stages and guardrails",
                "description": "Document eligibility, ramp percentages, and rollback criteria for each stage."
              },
              {
                "title": "Add targeting rules for each stage",
                "description": "Implement flags/segments to progressively target users by stage."
              },
              {
                "title": "Add monitoring and rollback checks",
                "description": "Add health metrics, alerting thresholds, and an automated rollback trigger."
              }
            ],
            "suggested_tags": ["release", "rollout"],
            "suggested_owner_user_ids": []
          }
        }
      ],
      "clarification_needed": false
    }
  ]
}
`;

export const proactiveNudgeAgent: Agent<ProactiveNudgeContext, ProactiveNudgeOutputLenient> = {
  name: 'ProactiveNudgeExtractor',
  instructions: () => DEFAULT_NUDGE_PROMPT,
  modelConfig: {
    temperature: 0.1,
  },
};

export const proactiveNudgeAgentRegistry = new Map<string, Agent<ProactiveNudgeContext, any>>([
  ['ProactiveNudgeExtractor', proactiveNudgeAgent],
]);

const CODE_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/i;
const DEFAULT_NUDGE_MODEL = "glm-flash-experimental"

export function parseLLMJson(content: string): unknown {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(CODE_FENCE_REGEX);
  const jsonPayload = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(jsonPayload);
}

function buildPrompt(input: ProactiveNudgeInput): string {
  return JSON.stringify(input, null, 2);
}

export async function generateNudges(
  input: ProactiveNudgeInput,
  context: ProactiveNudgeContext
): Promise<ProactiveNudgeOutputLenient> {
  const provider = makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);
  const prompt = buildPrompt(input);

  const initialState: RunState<ProactiveNudgeContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: prompt }],
    currentAgentName: 'ProactiveNudgeExtractor',
    context,
    turnCount: 0,
  };

  const runConfig: RunConfig<ProactiveNudgeContext> = {
    agentRegistry: proactiveNudgeAgentRegistry,
    modelProvider: provider as RunConfig<ProactiveNudgeContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: DEFAULT_NUDGE_MODEL,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    const parsed = typeof output === 'string' ? parseLLMJson(output) : output;
    return NudgeOutputSchemaLenient.parse(parsed);
  }

  if (result.outcome.status === 'error') {
    throw new Error(`Proactive nudge extraction failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Proactive nudge extraction interrupted.');
}
