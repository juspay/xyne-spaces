import { z } from 'zod';
import { QueryVisualizationType } from '../zero/schema';
import { QueryPlanSchema } from './queryPlan';

// AI-driven dashboard creation: tool-call event protocol.
//
// The dashboard AI route streams Server-Sent Events back to the client.
// Three event kinds are relevant to the dashboard creation flow:
//
//   - `delta` — incremental assistant prose (the chat bubble text).
//   - `tool_call` — structured action AI wants to take on the draft
//     dashboard (add a component, change visibility, rename, etc.).
//   - `complete` — terminal signal the assistant has finished a turn.
//   - `error` — terminal signal with a user-visible message.
//
// The client maintains the "draft DashboardPlan" by reducing the
// tool_call events as they arrive. This decoupling means AI can emit a
// long-form explanation in `delta` events while building the dashboard
// piece-by-piece via `tool_call` events — the user sees both the
// reasoning and the preview update incrementally.
//
// Mirrors the structure of the existing /api/xyne-ai SSE protocol so the
// XyneAIStreamManager can be lightly extended rather than duplicated.

// ---------- Tool: add_component ----------
// Drop a new component onto the draft dashboard. `position` is optional —
// the client computes a "below existing tiles" position if omitted, the
// same as ComponentEditorModal's auto-place flow.
export const AddComponentToolSchema = z.object({
  tool: z.literal('add_component'),
  args: z.object({
    visualType: z.nativeEnum(QueryVisualizationType),
    title: z.string().min(1),
    queryPlan: QueryPlanSchema,
    position: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        w: z.number().int().positive().max(12),
        h: z.number().int().positive(),
      })
      .optional(),
    // Per-component runtime hints. Currently the only field is
    // `timeColumn`, which tells the dashboard-level time-range picker
    // which column to filter on for this tile. AI should set this on
    // any time-series chart (line / area) AND on any tile where the
    // user might want to scope by time (e.g. "recent N" tables on a
    // timestamped table). Omitting it = tile ignores the time range.
    componentConfig: z
      .object({
        timeColumn: z.string().min(1).optional(),
      })
      .optional(),
  }),
});

// ---------- Tool: remove_component ----------
// Drop a component from the draft. Identified by the client-side
// componentId that was generated when AI emitted `add_component`. The
// AI doesn't track ids itself — the client wraps each add_component
// with a uuid and tells AI which ids exist on the draft in the next
// turn's system context.
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
    position: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        w: z.number().int().positive().max(12),
        h: z.number().int().positive(),
      })
      .optional(),
    componentConfig: z
      .object({
        timeColumn: z.string().min(1).optional(),
      })
      .optional(),
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

export const DashboardToolCallSchema = z.discriminatedUnion('tool', [
  AddComponentToolSchema,
  RemoveComponentToolSchema,
  UpdateComponentToolSchema,
  SetDashboardMetaToolSchema,
  SuggestComponentsToolSchema,
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
  z.object({
    type: z.literal('tool_call'),
    call: DashboardToolCallSchema,
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
    // When set, the error is recoverable — typically a malformed
    // tool_call AI emitted. The client should surface the message and
    // let the user retry / send a corrective follow-up.
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

// ---------- DashboardPlan (client-side draft state) ----------
// The reducer over tool_call events produces this shape. The client
// passes it back to the server on each follow-up turn so AI sees its
// own work as context, and uses it to render the preview.
//
// `components[i].id` is a client-generated uuid set when AI emits
// add_component. AI doesn't choose ids — when AI wants to reference a
// prior component it uses the id present in the plan it just received.
export const DraftComponentSchema = z.object({
  id: z.string().min(1),
  visualType: z.nativeEnum(QueryVisualizationType),
  // Title may be empty: the DB column is nullable, and `currentPlan`
  // round-trips DB rows back through this schema for the edit-via-chat
  // flow. The add_component tool definition still requires a non-empty
  // title from AI; that constraint lives on `AddComponentToolSchema`.
  title: z.string(),
  queryPlan: QueryPlanSchema,
  position: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive().max(12),
    h: z.number().int().positive(),
  }),
  // Runtime hints — mirrors dashboardComponent.config on the DB row.
  componentConfig: z
    .object({
      timeColumn: z.string().min(1).optional(),
    })
    .optional(),
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
});
export type DashboardAiCreateRequest = z.infer<typeof DashboardAiCreateRequestSchema>;
