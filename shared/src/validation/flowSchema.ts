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
// that varies by status is presentation (badge colour + label) — which is
// derived in the renderer, never shipped on the wire. So a discriminated union
// would be four byte-identical branches: pure boilerplate with no illegal-state
// to prevent. The real invariant ("status is one of exactly four") is already
// enforced by z.enum, so the robust, reality-matching shape is a flat object.
//
// The card is fully static: nothing lives in flow-state, there is no action.
// Each status is a FRESH post (unique screenId); the card never updates in place.
// ticketId/desc are optional (not every PR is ticket-linked or described). Each
// URL is optional so "no link" is representable as `undefined` (honest) rather
// than "" (a sentinel that conflates absent with empty); the renderer hides a
// button whose URL is absent, and drops the footer when both are.
export const prStatusSchema = z.enum(['created', 'merged', 'reverted', 'deleted']);

export const prPropsSchema = z
  .object({
    status: prStatusSchema,
    title: z.string().min(1),
    ticketId: z.string().min(1).optional(),
    desc: z.string().optional(),
    detailsUrl: z.string().min(1).optional(),
    bitbucketUrl: z.string().min(1).optional(),
  })
  .strict();

export const prComponentSchema = baseComponentSchema.extend({
  type: z.literal('pr'),
  props: prPropsSchema,
});

// TS mirrors inferred from the schema so the two can't drift.
export type PrStatus = z.infer<typeof prStatusSchema>;
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
    planComponentSchema,
    prComponentSchema,
    prApprovalComponentSchema,
    callScheduleComponentSchema,
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
  components: z.array(flowComponentSchema).min(1),
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
