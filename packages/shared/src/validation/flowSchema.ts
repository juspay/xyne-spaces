import { z } from 'zod';

// ============================================================================
// VALIDATION RULES
// ============================================================================

export const validationRuleSchema = z.object({
  type: z.enum(['required', 'minLength', 'maxLength', 'pattern', 'email', 'min', 'max', 'custom']),
  value: z.union([z.number(), z.string()]).optional(),
  message: z.string(),
});

// ============================================================================
// SELECT OPTION
// ============================================================================

export const selectOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  icon: z.string().optional(),
  disabled: z.boolean().optional(),
  description: z.string().optional(),
});

// ============================================================================
// FLOW ACTION (v2 — no endpoint/method/headers)
// ============================================================================

export const flowActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('submit'),
    actionId: z.string(),
    successMessage: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('inputChange'),
    actionId: z.string(),
    debounceMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('update_state'),
    stateUpdates: z.record(z.unknown()),
    successMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('close_screen'),
    finalMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('navigate'),
    target: z.string(),
  }),
  // Client-only: writes `value` to the clipboard. No network call, no app backend.
  z.object({
    type: z.literal('copy'),
    value: z.string(),
    successMessage: z.string().optional(),
  }),
]);

// ============================================================================
// COMPONENT STYLE
// ============================================================================

export const flowComponentStyleSchema = z.object({
  padding: z.string().optional(),
  margin: z.string().optional(),
  gap: z.string().optional(),
  align: z.enum(['left', 'center', 'right', 'stretch']).optional(),
  width: z.string().optional(),
  maxWidth: z.string().optional(),
  minWidth: z.string().optional(),
  backgroundColor: z.string().optional(),
  borderRadius: z.string().optional(),
  border: z.string().optional(),
  borderLeft: z.string().optional(),
});

// ============================================================================
// BASE COMPONENT (shared fields)
// ============================================================================

const baseComponentSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  props: z.record(z.unknown()).optional(),
  style: flowComponentStyleSchema.optional(),
  hidden: z.union([z.boolean(), z.string()]).optional(),
  disabled: z.union([z.boolean(), z.string()]).optional(),
}) ;

// ============================================================================
// COMPONENT SCHEMAS (typed — props are well-typed for validation)
// ============================================================================

export const textComponentSchema = baseComponentSchema.extend({
  type: z.literal('text'),
  props: z.object({
    content: z.string(),
    variant: z.enum(['default', 'muted', 'success', 'warning', 'danger']).optional(),
    size: z.enum(['xs', 'sm', 'base', 'lg', 'xl']).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    codeBlock: z.boolean().optional(),
  }).strict().optional(),
});

export const headingComponentSchema = baseComponentSchema.extend({
  type: z.literal('heading'),
  props: z.object({
    content: z.string(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  }).strict().optional(),
});

export const inputComponentSchema = baseComponentSchema.extend({
  type: z.literal('input'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    type: z.enum(['text', 'email', 'password', 'number', 'tel', 'url']).optional(),
    required: z.boolean().optional(),
    validation: z.array(validationRuleSchema).optional(),
    defaultValue: z.string().optional(),
    helperText: z.string().optional(),
    action: flowActionSchema.optional(),
  }).strict(),
});

export const textareaComponentSchema = baseComponentSchema.extend({
  type: z.literal('textarea'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
    required: z.boolean().optional(),
    validation: z.array(validationRuleSchema).optional(),
    defaultValue: z.string().optional(),
  }).strict(),
});

// options can be a static array or "$<key>" dynamic reference
const selectOptionsField = z.union([
  z.array(selectOptionSchema),
  z.string().refine((s) => s.startsWith('$'), {
    message: 'String options must be a "$<key>" reference (e.g. "$myOptions")',
  }),
]);

export const dropdownComponentSchema = baseComponentSchema.extend({
  type: z.literal('dropdown'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    options: selectOptionsField,
    required: z.boolean().optional(),
    action: flowActionSchema.optional(),
  }).strict(),
});

export const selectComponentSchema = baseComponentSchema.extend({
  type: z.literal('select'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    options: selectOptionsField,
    required: z.boolean().optional(),
    defaultValue: z.string().optional(),
    orientation: z.enum(['horizontal', 'vertical']).optional(),
  }).strict(),
});

export const multiselectComponentSchema = baseComponentSchema.extend({
  type: z.literal('multiselect'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    options: selectOptionsField,
    required: z.boolean().optional(),
    defaultValue: z.array(z.string()).optional(),
    orientation: z.enum(['horizontal', 'vertical']).optional(),
  }).strict(),
});

export const dateComponentSchema = baseComponentSchema.extend({
  type: z.literal('date'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
  }).strict().optional(),
});

export const buttonComponentSchema = baseComponentSchema.extend({
  type: z.literal('button'),
  props: z.object({
    label: z.string(),
    variant: z.enum(['primary', 'secondary', 'destructive', 'ghost', 'outline']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    icon: z.string().optional(),
    action: flowActionSchema.optional(),
  }).strict(),
});

export const dividerComponentSchema = baseComponentSchema.extend({
  type: z.literal('divider'),
});

export const imageComponentSchema = baseComponentSchema.extend({
  type: z.literal('image'),
  props: z.object({
    src: z.string().min(1),
    alt: z.string().optional(),
    width: z.union([z.string(), z.number()]).optional(),
    height: z.union([z.string(), z.number()]).optional(),
    objectFit: z.enum(['cover', 'contain', 'fill']).optional(),
    xyne_file_id: z.string().optional(),
  }).strict().optional(),
});

export const linkComponentSchema = baseComponentSchema.extend({
  type: z.literal('link'),
  props: z.object({
    href: z.string().url(),
    label: z.string(),
    external: z.boolean().optional(),
    underline: z.boolean().optional(),
  }).strict(),
});

/**
 * Roster summary — "you have N agents", with a link into the agent library.
 *
 * Counts only; the individual agents are the `agent` card's job. Emitted when a
 * user asks what agents exist, where a prose list of 30 names is unreadable and
 * the library page is the real answer. The route is NOT carried in props: the
 * dashboard's router already knows the workspace, so the node builds its own
 * link and a payload can never point this CTA somewhere else.
 */
export const agentSummaryComponentSchema = baseComponentSchema.extend({
  type: z.literal('agent_summary'),
  props: z
    .object({
      total: z.number().int().nonnegative(),
      global: z.number().int().nonnegative().optional(),
      personal: z.number().int().nonnegative().optional(),
      label: z.string().optional(),
      /** Sample rows, each opening the agent's own page. Server-picked. */
      agents: z
        .array(
          z
            .object({
              slug: z.string().min(1),
              name: z.string().min(1),
              description: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
});

export const tableComponentSchema = baseComponentSchema.extend({
  type: z.literal('table'),
  props: z.object({
    rows: z.array(z.array(z.string())),
    hasHeader: z.boolean().optional(),
    columnAlignments: z.array(z.enum(['left', 'center', 'right'])).optional(),
  }).strict(),
});

// ── Plan artifact ─────────────────────────────────────────────────────────
// The plan lifecycle is the discriminant: each `phase` carries only the todo
// axis meaningful in it. `proposed` todos have an `included` pick flag (user-
// toggleable); once the plan is approved the backend drops excluded todos and
// re-tags the rest with an execution `status`. Inclusion and execution never
// coexist on a todo, so the renderer branches once on phase — no cross-axis flag.
export const proposedTodoSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    included: z.boolean(),
  })
  .strict();

export const execTodoSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    status: z.enum(['queued', 'running', 'done', 'failed']),
  })
  .strict();

export const planPropsSchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('proposed'),
      title: z.string(),
      desc: z.string().optional(),
      // The DETAILED plan in markdown — the card briefs (title + todos); the
      // expanded view renders this full document. Authored once at propose time
      // and preserved verbatim across executing/done.
      document: z.string().optional(),
      todos: z.array(proposedTodoSchema),
      // Set when a NEWER plan has replaced this one (the agent re-planned). The
      // renderer greys the card out and disables Approve so a stale plan can't
      // be run. Absent on the live/current proposal.
      superseded: z.boolean().optional(),
      // Set when the user explicitly REJECTED this plan (tapped Reject). Terminal,
      // read-only, with a "Rejected by <decidedBy>" audit — no execution follows.
      rejected: z.boolean().optional(),
      // Display name of the human who approved/rejected — the audit footer.
      decidedBy: z.string().optional(),
      // ISO timestamp of the reject decision — rendered next to <decidedBy> in the
      // audit footer ("Rejected by <name> · <time>"). Captured server-side once.
      decidedAt: z.string().optional(),
    })
    .strict(),
  z
    .object({
      phase: z.literal('executing'),
      title: z.string(),
      desc: z.string().optional(),
      // The detailed markdown plan, carried over from the proposed card.
      document: z.string().optional(),
      todos: z.array(execTodoSchema),
      // Set when the plan skipped the user-approval gate because it was trivial
      // (auto-approved). The renderer shows an "Auto-approved" chip so the user
      // understands why execution started without them tapping Approve.
      autoApproved: z.boolean().optional(),
      // Display name of the human who approved this plan (absent when
      // auto-approved). Rendered as "Approved by <name>" — the who-approved
      // metadata.
      approvedBy: z.string().optional(),
      // ISO timestamp of the approve decision — rendered next to the approver in
      // the audit footer ("Approved by <name> · <time>" / "Auto-approved by the
      // agent · <time>"). Captured server-side ONCE at approve/trivial time and
      // preserved across live todo-write updates (never re-stamped per render).
      approvedAt: z.string().optional(),
    })
    .strict(),
  z
    .object({
      phase: z.literal('done'),
      title: z.string(),
      desc: z.string().optional(),
      // The detailed markdown plan, carried over from the proposed card.
      document: z.string().optional(),
      todos: z.array(execTodoSchema),
      autoApproved: z.boolean().optional(),
      approvedBy: z.string().optional(),
      approvedAt: z.string().optional(),
    })
    .strict(),
]);

export const planComponentSchema = baseComponentSchema.extend({
  type: z.literal('plan'),
  props: planPropsSchema,
});

// TS mirrors inferred from the schema so the two can't drift.
export type ProposedTodo = z.infer<typeof proposedTodoSchema>;
export type ExecTodo = z.infer<typeof execTodoSchema>;
export type ExecTodoStatus = ExecTodo['status'];
export type PlanProps = z.infer<typeof planPropsSchema>;
export type PlanPhase = PlanProps['phase'];

// ── PR artifact ───────────────────────────────────────────────────────────
// A read-only status card for a pull request. Unlike the plan, the field set is
// status-INVARIANT: every status carries the same fields, and the only thing
// that varies by status is presentation (badge colour + label, provider glyph +
// link label) — all derived in the renderer, never shipped on the wire. So a
// discriminated union would be four byte-identical branches: pure boilerplate
// with no illegal-state to prevent. The real invariant ("status is one of
// exactly four") is already enforced by z.enum, so the robust, reality-matching
// shape is a flat object.
//
// The card is fully static: nothing lives in flow-state, there is no action.
// It is PROVIDER-AGNOSTIC — `provider` selects the glyph and the "Open in
// <Provider>" label, and any host the runtime can't classify is 'other' (generic
// git glyph + neutral "Open pull request").
//
// LIFECYCLE: at creation time the runtime posts once with a screenId keyed on PR
// identity, then `updateMessage`s the SAME screenId to advance status in place
// (created → merged / reverted / deleted). AFTER the session ends, an inbound
// git-host webhook (e.g. Bitbucket pr:merged / pr:declined / pr:deleted) posts a
// FRESH status card into the same thread — see AgentWidgetBinding in claw-auth.
// `declined` is the webhook-only terminal status (a PR closed without merging);
// the agent tool path never emits it.
// ticketId/desc are optional (not every PR is ticket-linked or described). Each
// URL is optional so "no link" is representable as `undefined` (honest) rather
// than "" (a sentinel that conflates absent with empty); the renderer hides a
// button whose URL is absent, and drops the footer when both are.
export const prStatusSchema = z.enum(['created', 'merged', 'reverted', 'deleted', 'declined']);

// Which git host the PR lives on. Drives ONLY presentation (glyph + link label),
// never behaviour; anything the runtime can't classify normalizes to 'other'.
export const prProviderSchema = z.enum(['github', 'bitbucket', 'gitlab', 'other']);

export const prPropsSchema = z
  .object({
    status: prStatusSchema,
    provider: prProviderSchema,
    title: z.string().min(1),
    ticketId: z.string().min(1).optional(),
    desc: z.string().optional(),
    // Ticket / issue link — surfaced inside the details dialog.
    detailsUrl: z.string().min(1).optional(),
    // The pull request URL (provider-neutral). Renamed from the old
    // provider-locked `bitbucketUrl`.
    url: z.string().min(1).optional(),
  })
  .strict();

export const prComponentSchema = baseComponentSchema.extend({
  type: z.literal('pr'),
  props: prPropsSchema,
});

// TS mirrors inferred from the schema so the two can't drift.
export type PrStatus = z.infer<typeof prStatusSchema>;
export type PrProvider = z.infer<typeof prProviderSchema>;
export type PrProps = z.infer<typeof prPropsSchema>;

// ── PR approval artifact (interactive HITL) ─────────────────────────────────
// An interactive human-in-the-loop gate: the agent wants to perform a write
// (merge a PR) and asks the human to Approve/Deny. Unlike the read-only `pr`
// card, this one has a real flow-action round-trip.
//
// The lifecycle IS the discriminant — `phase`:
//   pending  → shows the meta row + Approve/Deny buttons (real submit actions).
//   resolved → shows the outcome badge (approved/denied), NO buttons.
// This earns a discriminated union (unlike `pr`'s flat enum): `outcome` exists
// EXACTLY when resolved and is unrepresentable while pending — the field set
// genuinely changes by phase. It is a 2-member union (not pending|approved|
// denied) because approved and denied carry an identical field set; only their
// presentation differs (green check vs red cross), which is derived in the
// renderer. The resolved outcome is agent-authoritative → read from props,
// never client state (freeze-bug discipline), so a backend `updateMessage` to
// the same screenId flips pending → resolved.
//
// Meta stats are structured; presentation (colours/labels) is derived in the
// renderer, never on the wire. `diff` is an atomic pair (both-or-neither), so
// "+N / −M" can never render half-populated. All meta fields are optional (a PR
// may lack CI, a diffstat, or pending reviews), and `meta` itself is optional.
export const prApprovalMetaSchema = z
  .object({
    ci: z.enum(['passing', 'failing', 'pending']).optional(),
    diff: z
      .object({
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    reviewsPending: z.number().int().nonnegative().optional(),
  })
  .strict();

export const prApprovalPropsSchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('pending'),
      title: z.string().min(1),
      url: z.string().min(1).optional(),
      meta: prApprovalMetaSchema.optional(),
    })
    .strict(),
  z
    .object({
      phase: z.literal('resolved'),
      title: z.string().min(1),
      url: z.string().min(1).optional(),
      meta: prApprovalMetaSchema.optional(),
      outcome: z.enum(['approved', 'denied']),
    })
    .strict(),
]);

export const prApprovalComponentSchema = baseComponentSchema.extend({
  type: z.literal('pr_approval'),
  props: prApprovalPropsSchema,
});

// TS mirrors inferred from the schema so the two can't drift.
export type PrApprovalMeta = z.infer<typeof prApprovalMetaSchema>;
export type PrApprovalProps = z.infer<typeof prApprovalPropsSchema>;
export type PrApprovalPhase = PrApprovalProps['phase'];
export type PrApprovalOutcome = Extract<PrApprovalProps, { phase: 'resolved' }>['outcome'];

// ── Call schedule artifact (interactive proposal) ───────────────────────────
// The agent proposes a call (title + attendees) with several start-time slots
// and a duration switcher; the human picks a slot + duration and Approves.
//
// The lifecycle IS the discriminant — `phase`:
//   proposed  → slots + duration switcher + Approve/Set-manually. The user's
//               chosen { slotId, duration } lives in flow-state (travels with
//               Approve); everything agent-authoritative stays in props.
//   scheduled → one confirmed start + duration, no switcher, no buttons.
// The field set genuinely changes by phase (proposed has `slots[]` + defaults;
// scheduled has a single `start` + `duration` and NO slots), so this earns a
// discriminated union — a flat shape would let a "scheduled" card still carry a
// slots array. Resolved state is agent-authoritative → read from props, never
// client state (freeze-bug discipline); a same-screenId `updateMessage` flips it.
//
// Slots carry START ONLY — the end time is DERIVED client-side from
// `start + selectedDuration`, so the displayed range recomputes when the user
// switches duration. `start` is an absolute UTC ISO string, formatted in the
// viewer's local tz. Duration options (30/45/60) are fixed in the renderer, not
// on the wire; `defaultDuration`/`defaultSlotId` are the agent's initial picks.
export const durationMinutesSchema = z.union([z.literal(30), z.literal(45), z.literal(60)]);

export const callSlotSchema = z
  .object({
    id: z.string().min(1),
    start: z.string().datetime({ offset: true }),
  })
  .strict();

export const callSchedulePropsSchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('proposed'),
      title: z.string().min(1),
      attendees: z.array(z.string().min(1)),
      slots: z.array(callSlotSchema).min(1),
      defaultSlotId: z.string().min(1).optional(),
      defaultDuration: durationMinutesSchema.optional(),
    })
    .strict(),
  z
    .object({
      phase: z.literal('scheduled'),
      title: z.string().min(1),
      attendees: z.array(z.string().min(1)),
      start: z.string().datetime({ offset: true }),
      duration: durationMinutesSchema,
    })
    .strict(),
]);

export const callScheduleComponentSchema = baseComponentSchema.extend({
  type: z.literal('call_schedule'),
  props: callSchedulePropsSchema,
});

// TS mirrors inferred from the schema so the two can't drift.
export type CallSlot = z.infer<typeof callSlotSchema>;
export type DurationMinutes = z.infer<typeof durationMinutesSchema>;
export type CallScheduleProps = z.infer<typeof callSchedulePropsSchema>;
export type CallSchedulePhase = CallScheduleProps['phase'];

/** A bare label, or a label plus the secondary line the option card renders under it. */
export const userQuestionOptionSchema = z.union([
  z.string().min(1),
  z.object({ label: z.string().min(1), description: z.string().min(1).optional() }).strict(),
]);

export const userQuestionItemSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), label: z.string().min(1).optional(), question: z.string().min(1), type: z.literal('single_choice'), options: z.array(userQuestionOptionSchema).min(2).max(9), required: z.boolean().optional() }).strict(),
  z.object({ id: z.string().min(1), label: z.string().min(1).optional(), question: z.string().min(1), type: z.literal('multiple_choice'), options: z.array(userQuestionOptionSchema).min(2).max(9), required: z.boolean().optional() }).strict(),
  z.object({ id: z.string().min(1), label: z.string().min(1).optional(), question: z.string().min(1), type: z.literal('open_ended'), placeholder: z.string().optional(), required: z.boolean().optional() }).strict(),
]);

export const userQuestionPropsSchema = z.object({
  title: z.string().min(1),
  questions: z.array(userQuestionItemSchema).min(1).max(8),
  // Absent on cards posted before terminal question states were introduced;
  // the renderer interprets absence as `pending`.
  phase: z.enum(['pending', 'answered', 'declined']).optional(),
  answers: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  /** Optional notes are scoped to the individual prompt id. */
  notes: z.record(z.string()).optional(),
  decidedAt: z.string().optional(),
  submitAction: flowActionSchema.optional(),
  dismissAction: flowActionSchema.optional(),
}).strict();

export const userQuestionComponentSchema = baseComponentSchema.extend({ type: z.literal('user_question'), props: userQuestionPropsSchema });
export type UserQuestionItem = z.infer<typeof userQuestionItemSchema>;
export type UserQuestionOption = z.infer<typeof userQuestionOptionSchema>;
export type UserQuestionProps = z.infer<typeof userQuestionPropsSchema>;

export const codePropsSchema = z
  .object({
    code: z.string().min(1),
    language: z.string().min(1).optional(),
  })
  .strict();

export const codeComponentSchema = baseComponentSchema.extend({
  type: z.literal('code'),
  props: codePropsSchema,
});

export const diffPropsSchema = z
  .object({
    path: z.string().min(1),
    patch: z.string().min(1),
  })
  .strict();

export const diffComponentSchema = baseComponentSchema.extend({
  type: z.literal('diff'),
  props: diffPropsSchema,
});

export const ticketStatusSchema = z.enum(['TODO', 'STARTED', 'PAUSED', 'CANCELLED', 'COMPLETED']);
export const ticketPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const ticketPropsSchema = z
  .object({
    xyneId: z.string().min(1).optional(),
    ticketId: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    status: ticketStatusSchema,
    priority: ticketPrioritySchema,
    stageName: z.string().min(1).optional(),
    eta: z.string().optional(),
    url: z.string().min(1).optional(),
    channelId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
    assigneeId: z.string().min(1).optional(),
    phase: z.enum(['proposed', 'created']).optional(),
    approveAction: flowActionSchema.optional(),
    approveContinueAction: flowActionSchema.optional(),
    declineAction: flowActionSchema.optional(),
  })
  .strict();

export const ticketComponentSchema = baseComponentSchema.extend({
  type: z.literal('ticket'),
  props: ticketPropsSchema,
});

export const chartPointSchema = z
  .object({ label: z.string().min(1), value: z.number().finite() })
  .strict();

export const chartSeriesPointSchema = z
  .object({
    x: z.string().min(1),
    y: z.number().finite(),
    series: z.string().min(1).optional(),
  })
  .strict();

const CHART_MAX_POINTS = 200;

const categoryChartSchema = <T extends 'bar' | 'pie' | 'donut'>(type: T) =>
  z
    .object({
      type: z.literal(type),
      points: z.array(chartPointSchema).min(1).max(24),
      caption: z.string().min(1).optional(),
    })
    .strict();

const seriesChartSchema = <T extends 'line' | 'area'>(type: T) =>
  z
    .object({
      type: z.literal(type),
      series: z.array(chartSeriesPointSchema).min(1).max(CHART_MAX_POINTS),
      caption: z.string().min(1).optional(),
    })
    .strict();

export const chartPropsSchema = z.discriminatedUnion('type', [
  categoryChartSchema('bar'),
  categoryChartSchema('pie'),
  categoryChartSchema('donut'),
  seriesChartSchema('line'),
  seriesChartSchema('area'),
]);

export const chartComponentSchema = baseComponentSchema.extend({
  type: z.literal('chart'),
  props: chartPropsSchema,
});

export type CodeProps = z.infer<typeof codePropsSchema>;
export type DiffProps = z.infer<typeof diffPropsSchema>;
export type TicketProps = z.infer<typeof ticketPropsSchema>;
export type TicketArtifactStatus = z.infer<typeof ticketStatusSchema>;
export type TicketArtifactPriority = z.infer<typeof ticketPrioritySchema>;
export type ChartProps = z.infer<typeof chartPropsSchema>;
export type ChartType = ChartProps['type'];
export type ChartPoint = z.infer<typeof chartPointSchema>;
export type ChartSeriesPoint = z.infer<typeof chartSeriesPointSchema>;

// ── Agent artifact ────────────────────────────────────────────────────────────
// ONE node renders every agent surface. The identity block (name / slug /
// description / model / capabilities / system prompt) is INVARIANT across
// variants — that identity IS the artifact. `variant` discriminates only the
// chrome: which header chip, which footer affordances, and whether the
// capability chips are interactive.
//
//   draft   → the agent does NOT exist yet. `phase` walks pending → created |
//             rejected on the SAME message (post once, then updateMessage the
//             same screenId), exactly like the plan card.
//   profile → a live agent, read-only ("tell me about this agent").
//
// Extension rule: a new surface is a NEW UNION BRANCH, never a new field on an
// existing one — existing emitters keep validating unchanged. Presentational
// key/value rows (model settings, limits, quotas) go in `agent.details` and need
// no schema change at all; only making a field EDITABLE earns a new branch.
//
// INVARIANT: props are PRESENTATION ONLY. Every identifier the server acts on
// (requestId, agentSlug, the acting userId, routing) lives in flowJSON.data —
// the whole flowJSON round-trips through the client, so props are untrusted.
export const agentCapabilitySchema = z
  .object({
    /** Subagent name or custom tool slug — the identifier config.tools stores. */
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(['subagent', 'tool']),
    /**
     * MCP serverType whose brand icon represents this capability, e.g. "github".
     * Set server-side (the subagent name and the icon key differ — "spaces" is
     * served by "xyne-spaces"), so the renderer never has to guess a filename.
     */
    iconKey: z.string().optional(),
    /** serverType whose account/credentials this capability needs, when unconnected. */
    requiresConnection: z.string().optional(),
  })
  .strict();

/** Presentational label/value row (model, thinking level, limits, …). */
export const agentDetailRowSchema = z
  .object({
    label: z.string().min(1),
    value: z.string(),
  })
  .strict();

export const agentIdentitySchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1),
    /** Handle credited under the name ("Built by @fractal-agent") — who authored it. */
    builtBy: z.string().optional(),
    /** Owner's display name, credited in the chin ("Created by @aryan.pidiha"). */
    ownedBy: z.string().optional(),
    /** Owner's user id — renders their avatar beside the credit. */
    ownedById: z.string().optional(),
    /** Reach: 'global' is org-wide, 'personal' belongs to one user. */
    scope: z.enum(['personal', 'global']).optional(),
    description: z.string().optional(),
    /** Full system prompt — revealed in the expanded view, never the card body. */
    systemPrompt: z.string().optional(),
    modelId: z.string().optional(),
    /**
     * Hex tint the agent is created with, e.g. '#6366f1'. Carried so the card
     * reflects what gets persisted; no current surface paints with it (the cards
     * render no avatar).
     */
    color: z.string().optional(),
    capabilities: z.array(agentCapabilitySchema).optional(),
    details: z.array(agentDetailRowSchema).optional(),
    connectLinks: z
      .array(
        z
          .object({
            serverType: z.string().min(1),
            displayName: z.string().min(1),
            authUrl: z.string().url(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const agentDraftPhaseSchema = z.enum(['pending', 'created', 'rejected']);

export const agentPropsSchema = z.discriminatedUnion('variant', [
  z
    .object({
      variant: z.literal('draft'),
      phase: agentDraftPhaseSchema,
      agent: agentIdentitySchema,
      // Seeds state.values[node.id] — the capability ids kept by the user. The
      // live selection then lives in flow state (the plan card's pattern), so
      // `capabilities` stays byte-identical across variants.
      selected: z.array(z.string()).optional(),
      // Muted footnote, e.g. "skipped unknown tools: foo, bar".
      note: z.string().optional(),
      // Audit for the decided phases.
      decidedBy: z.string().optional(),
      /** User id of the decider — renders their avatar beside the audit line. */
      decidedById: z.string().optional(),
      decidedAt: z.string().optional(),
    })
    .strict(),
  z
    .object({
      variant: z.literal('profile'),
      agent: agentIdentitySchema,
      note: z.string().optional(),
    })
    .strict(),
]);

export const agentComponentSchema = baseComponentSchema.extend({
  type: z.literal('agent'),
  props: agentPropsSchema,
});

// TS mirrors inferred from the schema so the two can't drift.
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;
export type AgentDetailRow = z.infer<typeof agentDetailRowSchema>;
export type AgentIdentity = z.infer<typeof agentIdentitySchema>;
export type AgentProps = z.infer<typeof agentPropsSchema>;
export type AgentVariant = AgentProps['variant'];
export type AgentDraftProps = Extract<AgentProps, { variant: 'draft' }>;
export type AgentDraftPhase = AgentDraftProps['phase'];
export type AgentProfileProps = Extract<AgentProps, { variant: 'profile' }>;

// ── Slash-command artifact ────────────────────────────────────────────────
// A slash command can emit a persistent, structured message card. Message
// content carries ONLY the command identifier and the body: presentation and
// side-effect policy (badge, labels, who gets notified) are resolved from the
// registry in utils/slashCommandArtifact.ts. Message content is authored by
// the client, so anything it declared about its own audience would be
// self-granted privilege. Lifecycle state (active/completed, linked call)
// likewise lives only on the `message_artifacts` row.
// Unknown props are stripped rather than rejected so artifacts written by an
// older client still render.
export const slashCommandArtifactEndedCallSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  joinedCount: z.number().int().nonnegative(),
});

export const slashCommandArtifactClosedSchema = z.object({
  closedAt: z.number().int().nonnegative(),
  closedBy: z.string(),
});

export const slashCommandArtifactPropsSchema = z.object({
  command: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  /**
   * Summary of the last call this artifact ran, written by the server exactly
   * once when that call ends. It lives here rather than on `message_artifacts`
   * because an ended call has already left the client's active-call
   * subscription, and this is the same shape the standard call system message
   * uses (content rewritten once at end-of-call).
   *
   * Only trusted when no live artifact row contradicts it — message content is
   * client-authored, so a crafted client could ship a message that already
   * claims a call ended.
   */
  endedCall: slashCommandArtifactEndedCallSchema.optional(),
  /**
   * Written once when the message's author closes the artifact without ever
   * running — or after having run — a call. Same reasoning as `endedCall`: a
   * closed artifact drops out of the ACTIVE-only artifact subscription, so the
   * card would otherwise fall back to looking brand new.
   *
   * Only trusted when no live artifact row contradicts it.
   */
  closed: slashCommandArtifactClosedSchema.optional(),
});

export type SlashCommandArtifactEndedCall = z.infer<
  typeof slashCommandArtifactEndedCallSchema
>;

export type SlashCommandArtifactClosed = z.infer<
  typeof slashCommandArtifactClosedSchema
>;

export const slashCommandArtifactComponentSchema = baseComponentSchema.extend({
  type: z.literal('slash_command_artifact'),
  props: slashCommandArtifactPropsSchema,
  // The message body is a normal Flow text node, which keeps mentions and
  // formatting consistent with every other FlowJSON message.
  children: z.array(textComponentSchema).min(1).max(1),
});

export type SlashCommandArtifactProps = z.infer<
  typeof slashCommandArtifactPropsSchema
>;

// ── MCP configure card ────────────────────────────────────────────────────────
// The agent asks for an account it needs but the user hasn't connected. It posts
// this card; the USER types the credentials in the dashboard and they go
// browser → claw-auth directly.
//
// INVARIANT: no secret ever appears in these props. `fields` describes WHICH
// inputs to render (name/label/type), never their values — a credential passed
// as a tool argument would land in the model's context, the run transcript and
// the logs. `mcpServerId` is the only thing the server acts on, and the whole
// flowJSON round-trips through the client, so props are untrusted regardless.
export const mcpCredentialFieldSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(['text', 'password']),
    placeholder: z.string().optional(),
    optional: z.boolean().optional(),
  })
  .strict();

export const mcpConfigurePropsSchema = z
  .object({
    serverType: z.string().min(1),
    serverName: z.string().min(1),
    mcpServerId: z.string().min(1),
    reason: z.string().optional(),
    fields: z.array(mcpCredentialFieldSchema).min(1),
  })
  .strict();


export const mcpSuggestItemSchema = z
  .object({
    serverType: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    connected: z.boolean().optional(),
  })
  .strict();

export const mcpSuggestPropsSchema = z
  .object({
    title: z.string().optional(),
    reason: z.string().optional(),
    connectors: z.array(mcpSuggestItemSchema).min(1),
    /** Roster mode: render a "Browse MCPs" footer into the connector library. */
    browseAll: z.boolean().optional(),
    /** Total connectors available, so the footer can say what is not shown. */
    totalCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const mcpSuggestComponentSchema = baseComponentSchema.extend({
  type: z.literal('mcp_suggest'),
  props: mcpSuggestPropsSchema,
});

export type McpSuggestItem = z.infer<typeof mcpSuggestItemSchema>;
export type McpSuggestProps = z.infer<typeof mcpSuggestPropsSchema>;

export const mcpConfigureComponentSchema = baseComponentSchema.extend({
  type: z.literal('mcpConfigure'),
  props: mcpConfigurePropsSchema,
});

export type McpCredentialField = z.infer<typeof mcpCredentialFieldSchema>;
export type McpConfigureProps = z.infer<typeof mcpConfigurePropsSchema>;

// Recursive container schemas need z.lazy
export const flowComponentSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion('type', [
    textComponentSchema,
    headingComponentSchema,
    inputComponentSchema,
    textareaComponentSchema,
    dropdownComponentSchema,
    selectComponentSchema,
    multiselectComponentSchema,
    dateComponentSchema,
    buttonComponentSchema,
    dividerComponentSchema,
    imageComponentSchema,
    linkComponentSchema,
    tableComponentSchema,
    agentSummaryComponentSchema,
    planComponentSchema,
    prComponentSchema,
    prApprovalComponentSchema,
    callScheduleComponentSchema,
    userQuestionComponentSchema,
    codeComponentSchema,
    diffComponentSchema,
    ticketComponentSchema,
    chartComponentSchema,
    agentComponentSchema,
    mcpConfigureComponentSchema,
    mcpSuggestComponentSchema,
    slashCommandArtifactComponentSchema,
    // Container types — inline here so they can reference flowComponentSchema
    baseComponentSchema.extend({
      type: z.literal('row'),
      children: z.array(z.lazy(() => flowComponentSchema)).optional(),
    }),
    baseComponentSchema.extend({
      type: z.literal('column'),
      children: z.array(z.lazy(() => flowComponentSchema)).optional(),
    }),
    baseComponentSchema.extend({
      type: z.literal('card'),
      children: z.array(z.lazy(() => flowComponentSchema)).optional(),
    }),
  ]),
);

// TEMPORARY — remove once every deploy target ships the same @xyne/shared.
//
// The union above is a HARD gate: an unrecognised `type` fails validation for
// the WHOLE flow, and this same schema runs on Spaces' postMessage ingest. So a
// card emitted by a newer claw against an older backend is not partially
// rendered — the entire message is rejected and nothing reaches the thread, with
// no error the user can see. That is how the `agent` card (PR #279) went dark:
// the emitter shipped, the schema did not.
//
// Until shared/backend/dashboard are deployed in lockstep, an unknown component
// is allowed through as an opaque passthrough node. Known types keep their
// strict validation — this only widens the door for types this build has never
// heard of. The renderer degrades them to a readable JSON block.
// Component types THIS build knows. The lenient branch must refuse these —
// otherwise a malformed `text` node (say, one missing `content`) stops failing
// validation and quietly degrades to an "unsupported card" instead, which is a
// worse bug than the one this shim fixes.
const KNOWN_COMPONENT_TYPES = new Set([
  'text', 'heading', 'input', 'textarea', 'dropdown', 'select', 'multiselect',
  'date', 'button', 'divider', 'image', 'link', 'table', 'plan', 'pr',
  'pr_approval', 'call_schedule', 'agent', 'agent_summary', 'mcpConfigure', 'mcp_suggest', 'row', 'column', 'card',
]);

const unknownComponentSchema = baseComponentSchema
  .extend({
    type: z
      .string()
      .min(1)
      .refine((t) => !KNOWN_COMPONENT_TYPES.has(t), {
        message: 'known component type must satisfy its own schema',
      }),
  })
  .passthrough();

export const flowComponentSchemaLenient: z.ZodType<any> = z.lazy(() =>
  z.union([flowComponentSchema, unknownComponentSchema]),
);

// ============================================================================
// FLOW STATE
// ============================================================================

export const flowStateSchema = z.object({
  values: z.record(z.unknown()),
  touched: z.record(z.boolean()),
  errors: z.record(z.string()),
  submitting: z.boolean(),
  submitted: z.boolean(),
  history: z.array(z.string()),
  loadingComponentIds: z.array(z.string()),
});

// ============================================================================
// FLOW DEFINITION (v2)
// ============================================================================

export const flowDefinitionSchema = z.object({
  version: z.literal('2.0'),
  screenId: z.string().min(1),
  title: z.string().optional(),
  // Lenient on purpose — see flowComponentSchemaLenient. A single unknown
  // component must not reject the entire message at ingest.
  components: z.array(flowComponentSchemaLenient).min(1),
  data: z.record(z.unknown()).optional(),
  state: flowStateSchema,
});

// ============================================================================
// ACTION REQUEST (frontend → Xyne backend)
// ============================================================================

export const actionRequestSchema = z.object({
  actionId: z.string().min(1),
  type: z.enum(['submit', 'inputChange']),
  values: z.record(z.unknown()),
  context: z.object({
    flowJSON: flowDefinitionSchema,
    messageId: z.string().min(1),
    conversationId: z.string().min(1),
  }),
});

// ============================================================================
// APP ACTION RESPONSE (app backend → Xyne backend → frontend)
// ============================================================================

export const appActionResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('open_screen'),
    flowJSON: flowDefinitionSchema,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('next_screen'),
    flowJSON: flowDefinitionSchema,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('close_screen'),
    finalMessage: z.string().optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('update_screen_data'),
    data: z.record(z.unknown()),
    componentUpdates: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('ack'),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
  }),
]);

// ============================================================================
// FLOW UI METADATA (stored in DB message)
// ============================================================================

export const flowUIMetadataSchema = z.object({
  hasFlowUI: z.literal(true),
  flowVersion: z.literal('2.0'),
  flowId: z.string().min(1),
  appId: z.string().min(1),
  flowJSON: flowDefinitionSchema,
});

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type ValidatedFlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type ValidatedFlowComponent = z.infer<typeof flowComponentSchema>;
export type ValidatedActionRequest = z.infer<typeof actionRequestSchema>;
export type ValidatedAppActionResponse = z.infer<typeof appActionResponseSchema>;
export type ValidatedFlowUIMetadata = z.infer<typeof flowUIMetadataSchema>;
export type ValidatedFlowAction = z.infer<typeof flowActionSchema>;

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function validateFlowDefinition(data: unknown) {
  return flowDefinitionSchema.safeParse(data);
}

export function validateFlowComponent(data: unknown) {
  return flowComponentSchema.safeParse(data);
}

export function validateActionRequest(data: unknown) {
  return actionRequestSchema.safeParse(data);
}

export function validateAppActionResponse(data: unknown) {
  return appActionResponseSchema.safeParse(data);
}

export function validateFlowUIMetadata(data: unknown) {
  return flowUIMetadataSchema.safeParse(data);
}

export function formatValidationErrors(result: { success: false; error: z.ZodError }): string[] {
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

// ============================================================================
// DEPRECATED — kept for backward compatibility
// ============================================================================

/** @deprecated Use validateFlowDefinition */
export function validateFlowJSON(data: unknown) {
  return flowDefinitionSchema.safeParse(data);
}

/** @deprecated Use validateFlowComponent */
export function validateComponent(data: unknown) {
  return flowComponentSchema.safeParse(data);
}

/** @deprecated Use validateAppActionResponse */
export function validateFlowWebhookResponse(data: unknown) {
  return appActionResponseSchema.safeParse(data);
}

// Old type aliases for compat
/** @deprecated */
export const flowJSONSchema = flowDefinitionSchema;
/** @deprecated */
export const componentSchema = flowComponentSchema;
/** @deprecated */
export const flowWebhookResponseSchema = appActionResponseSchema;
/** @deprecated */
export type ValidatedFlowJSON = ValidatedFlowDefinition;
