import { z } from 'zod';

const NudgeTypeSchema = z.enum([
  'EXISTING_TICKET',
  'CREATE_TICKET',
  'SET_REMINDER',
  'ADD_TO_KB',
  'REVERSE_KB_LOOKUP',
  'THREAD_FOLLOW_UP',
  'DECISION_PENDING',
  'WAITING_ON_BLOCKED_BY',
]);

const NudgePrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);

const EvidenceSpanValueSchema = z
  .union([
    z.string(),
    z.array(
      z.object({
        text: z.string().optional(),
        start: z.number().int().optional(),
        end: z.number().int().optional(),
      }),
    ),
    z.object({
      text: z.string().optional(),
      start: z.number().int().optional(),
      end: z.number().int().optional(),
    }),
  ])
  .transform((value) => {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const firstWithText = value.find((item) => typeof item.text === 'string' && item.text.trim().length > 0);
      if (firstWithText?.text) {
        return firstWithText.text.trim();
      }
      return JSON.stringify(value);
    }

    if (typeof value.text === 'string' && value.text.trim().length > 0) {
      return value.text.trim();
    }

    return JSON.stringify(value);
  });

const LookupRequestsSchema = z
  .object({
    ticket_search_query: z.string().optional(),
    kb_lookup_query: z.string().optional(),
    kb_route_query: z.string().optional(),
  })
  .strict();

export const SuggestedActionSchema = z.object({
  label: z.string(),
  action_type: z.enum([
    'SEARCH_TICKETS',
    'CREATE_TICKET_FROM_MESSAGE',
    'OPEN_TICKET',
    'CREATE_REMINDER',
    'CREATE_KB_DRAFT_FROM_MESSAGE',
    'SEARCH_KB',
    'CREATE_DECISION',
    'CREATE_FOLLOWUP_REMINDER',
  ]),
  payload: z.record(z.any()),
});

const NudgeSchema = z.object({
  id: z.string(),
  type: NudgeTypeSchema,
  priority: NudgePrioritySchema,
  title: z.string(),
  description: z.string(),
  evidence_spans: EvidenceSpanValueSchema,
  lookup_requests: LookupRequestsSchema.optional(),
  suggested_actions: z.array(SuggestedActionSchema).optional(),
  clarification_needed: z.boolean().optional(),
  clarification_questions: z.array(z.string()).optional(),
});

const NudgeOutputSchema = z.object({
  schema_version: z.literal('1.0'),
  message_id: z.string(),
  generated_at_iso: z.string(),
  nudges: z.array(NudgeSchema).max(10),
  suppressed_candidates: z.array(z.any()).optional(),
});

export const NudgeOutputSchemaLenient = NudgeOutputSchema.extend({
  nudges: z.array(NudgeSchema),
});

export type ProactiveNudgeOutput = z.infer<typeof NudgeOutputSchema>;
export type ProactiveNudgeOutputLenient = z.infer<typeof NudgeOutputSchemaLenient>;
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
