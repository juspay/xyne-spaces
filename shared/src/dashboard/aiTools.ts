import { z } from 'zod';
import { QueryVisualizationType } from '../zero/schema';
import { QueryPlanSchema } from './queryPlan';

export const ComponentConfigSchema = z.object({
  timeColumn: z.string().min(1).optional(),
  unit: z.string().min(1).max(12).optional(),
  unitPosition: z.enum(['prefix', 'suffix']).optional(),
});
export type ComponentConfig = z.infer<typeof ComponentConfigSchema>;

// AI-driven dashboard editing: tool schemas + SSE event protocol.
//
// The dashboard-ai agent runs on xyne-claw; its tools execute server-side
// against /api/dashboard/claw/* (which validate every queryPlan and PERSIST
// component writes). The dashboard AI route proxies the run as Server-Sent
// Events in the shared vocabulary below:
//
//   - `delta` / `reasoning` — incremental assistant prose / thinking.
//   - `tool_activity` — a server-side tool started/completed; the client
//     renders activity badges and refetches the dashboard after writes.
//   - `complete` — terminal signal the assistant has finished a turn.
//   - `error` — terminal signal with a user-visible message.
//
// The tool schemas (DashboardToolCallSchema) are what the backend validates
// tool arguments against before applying them.

// ---------- Tool: add_component ----------
// Drop a new component onto the dashboard. `position` is optional — the
// server auto-places below existing tiles when omitted.
const TilePositionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive().max(12),
  h: z.number().int().positive(),
});

export const AddComponentToolSchema = z.object({
  tool: z.literal('add_component'),
  args: z.object({
    visualType: z.nativeEnum(QueryVisualizationType),
    title: z.string().min(1),
    queryPlan: QueryPlanSchema,
    position: TilePositionSchema.optional(),
    // Per-component runtime hints (time-range column, value unit). AI should set
    // `timeColumn` on any time-series or time-scopable tile so the dashboard
    // time-range picker knows which column to filter on. See ComponentConfigSchema.
    componentConfig: ComponentConfigSchema.optional(),
  }),
});

// ---------- Tool: remove_component ----------
// Drop a component from the dashboard, identified by componentId. Ids come
// from the persisted dashboard rows (under Claw the server creates them on
// add_component and returns them in the tool result; the current dashboard
// summary in the AI's context lists them each turn).
export const RemoveComponentToolSchema = z.object({
  tool: z.literal('remove_component'),
  args: z.object({
    componentId: z.string().min(1),
  }),
});

// ---------- Tool: update_component ----------
// Modify an existing component on the draft. Partial — only the fields
// AI wants to change. (Type changes are common — "make that bar a pie";
// query changes too — "show top 5 instead of all".)
export const UpdateComponentToolSchema = z.object({
  tool: z.literal('update_component'),
  args: z.object({
    componentId: z.string().min(1),
    visualType: z.nativeEnum(QueryVisualizationType).optional(),
    title: z.string().min(1).optional(),
    queryPlan: QueryPlanSchema.optional(),
    position: TilePositionSchema.optional(),
    componentConfig: ComponentConfigSchema.optional(),
  }),
});

// ---------- Tool: set_dashboard_meta ----------
// Set/update the top-level dashboard fields the user hasn't typed yet —
// title, description, visibility default. AI emits this once on the first
// turn (or on explicit "rename" follow-ups).
export const SetDashboardMetaToolSchema = z.object({
  tool: z.literal('set_dashboard_meta'),
  args: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
});

// ---------- Tool: suggest_components ----------
// Emitted when the AI CANNOT build what the user asked for as-is — e.g. the
// requested table/column doesn't exist on the selected source. Instead of a
// long prose apology, the AI returns a short plain-language reason plus a few
// ready-to-use alternative prompts the user can click to retry. The client
// renders these as suggestion chips.
export const SuggestComponentsToolSchema = z.object({
  tool: z.literal('suggest_components'),
  args: z.object({
    // One or two sentences, plain language, no markdown. Why the original
    // request can't be fulfilled and what's available instead.
    message: z.string().min(1),
    // 1–5 concrete alternatives. `label` is the short chip text; `prompt`
    // is the full instruction the client re-sends when the chip is clicked.
    suggestions: z
      .array(
        z.object({
          label: z.string().min(1).max(80),
          prompt: z.string().min(1).max(300),
        }),
      )
      .min(1)
      .max(5),
  }),
});

// ---------- Tool: drill_result ----------
// A one-off drill-down answer ("which orders make up that spike?"). Not
// persisted on the draft — the client renders the result as a chat bubble
// the user can optionally pin to the dashboard.
export const DrillResultToolSchema = z.object({
  tool: z.literal('drill_result'),
  args: z.object({
    title: z.string().min(1),
    visualType: z.nativeEnum(QueryVisualizationType),
    queryPlan: QueryPlanSchema,
  }),
});

export const DashboardToolCallSchema = z.discriminatedUnion('tool', [
  AddComponentToolSchema,
  RemoveComponentToolSchema,
  UpdateComponentToolSchema,
  SetDashboardMetaToolSchema,
  SuggestComponentsToolSchema,
  DrillResultToolSchema,
]);
export type DashboardToolCall = z.infer<typeof DashboardToolCallSchema>;

// ---------- SSE event envelope ----------
// Each event sent from the server is one of these shapes, JSON-encoded
// after `data: ` per the SSE convention. Client splits the stream by
// line and parses each `data:` payload into a DashboardAiEvent.
export const DashboardAiEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('delta'),
    content: z.string(),
  }),
  // Progress of a server-side tool invocation. The client renders activity
  // badges from it and reacts to a few tools by name (suggest_components,
  // drill_result, and the persisting component writes).
  z.object({
    type: z.literal('tool_activity'),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    args: z.record(z.unknown()).optional(),
    result: z.string().optional(),
    status: z.enum(['running', 'completed', 'error']),
    durationMs: z.number().optional(),
  }),
  // Incremental model reasoning (extended-thinking deltas).
  z.object({
    type: z.literal('reasoning'),
    reasoningDelta: z.string(),
  }),
  z.object({
    type: z.literal('complete'),
    // Optional summary AI emitted on turn close — surfaced as the final
    // assistant message in the chat UI.
    summary: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    // When set, the error is recoverable — the client should surface the
    // message and let the user retry / send a corrective follow-up.
    recoverable: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('start'),
    // Session id for follow-up messages — the existing XyneAI sessions
    // service persists turn history under this id.
    sessionId: z.string().min(1),
  }),
  z.object({
    type: z.literal('end'),
  }),
]);
export type DashboardAiEvent = z.infer<typeof DashboardAiEventSchema>;

// ---------- DashboardPlan (current dashboard state) ----------
// Snapshot of the dashboard the client sends with each turn so the AI sees
// its own work as context. `components[i].id` is the persisted component
// row's id — the AI references it when editing or removing a tile.
export const DraftComponentSchema = z.object({
  id: z.string().min(1),
  visualType: z.nativeEnum(QueryVisualizationType),
  // Title may be empty: the DB column is nullable, and `currentPlan`
  // round-trips DB rows back through this schema for the edit-via-chat
  // flow. The add_component tool definition still requires a non-empty
  // title from AI; that constraint lives on `AddComponentToolSchema`.
  title: z.string(),
  queryPlan: QueryPlanSchema,
  position: TilePositionSchema,
  // Runtime hints — mirrors dashboardComponent.config on the DB row.
  componentConfig: ComponentConfigSchema.optional(),
});
export type DraftComponent = z.infer<typeof DraftComponentSchema>;

export const DashboardPlanSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  components: z.array(DraftComponentSchema),
});
export type DashboardPlan = z.infer<typeof DashboardPlanSchema>;

// ---------- Request body for POST /api/dashboard-ai/create ----------
export const DashboardAiCreateRequestSchema = z.object({
  prompt: z.string().min(1),
  // Workspace-scoped data source the AI grounds on. Required for v1;
  // multi-source dashboards come later (mode = 'cross_source').
  dataSourceId: z.string().min(1),
  // Existing draft (when the user is iterating on a prior turn). Server
  // includes it in the AI's context window so follow-ups can reference
  // prior components ("change the bar to a pie", "drop the third tile").
  currentPlan: DashboardPlanSchema.optional(),
  // Continuity across turns — XyneAI session ids work transparently
  // here too. Server creates one on first turn and returns via `start`.
  sessionId: z.string().min(1).optional(),
  // The error message from the most recent failed preview/execution, if
  // any. When present, the backend includes it in the LLM's user message
  // so the model can self-correct on the next turn. Caps at 1000 chars
  // server-side (the LLM is fine with shorter; we don't need to ship
  // the full driver stack).
  lastError: z.string().max(1000).optional(),
  // Dashboard this chat edits. Doubles as the conversation id, so the
  // thread survives reloads and pod restarts.
  dashboardId: z.string().min(1).optional(),
  // Tile the user has focused in the editor — the AI scopes edits to it.
  focusedComponentId: z.string().min(1).optional(),
  // Start a fresh conversation instead of continuing the dashboard's thread.
  newThread: z.boolean().optional(),
});
export type DashboardAiCreateRequest = z.infer<typeof DashboardAiCreateRequestSchema>;
