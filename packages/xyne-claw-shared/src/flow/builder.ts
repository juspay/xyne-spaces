/**
 * FlowBuilder — fluent builder for FlowUI v2.0 definitions.
 *
 * Used by xyne-claw-auth (webhook result handler) and xyne-claw (agent runtime).
 *
 * Types are inlined here to avoid adding @xyne/shared as a runtime dependency
 * in xyne-claw-shared. They mirror @xyne/shared/types/flowUI exactly.
 */

import type { TwinDelivery, TwinReplyDestination } from "../types/twin-delivery.js";

// ── Inlined FlowUI types (mirrors @xyne/shared) ──────────────────────────────

type FlowComponentType =
  | 'text'
  | 'heading'
  | 'button'
  | 'input'
  | 'textarea'
  | 'dropdown'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'row'
  | 'column'
  | 'card'
  | 'divider'
  | 'image'
  | 'link'
  | 'plan'
  | 'connectAccount'
  | 'mcpConfigure'
  | 'agentCreation'
  | 'entityUpdate'
  | 'skillCreation'
  | 'skillUpdate';

interface FlowComponentStyle {
  padding?: string;
  margin?: string;
  gap?: string;
  align?: 'left' | 'center' | 'right' | 'stretch';
  width?: string;
  maxWidth?: string;
  minWidth?: string;
  backgroundColor?: string;
  borderRadius?: string;
  border?: string;
  borderLeft?: string;
  maxHeight?: string;
  overflow?: 'auto' | 'hidden' | 'visible' | 'scroll';
  overflowY?: 'auto' | 'hidden' | 'visible' | 'scroll';
}

export interface FlowComponent {
  id: string;
  type: FlowComponentType;
  props?: Record<string, unknown>;
  children?: FlowComponent[];
  style?: FlowComponentStyle;
  hidden?: boolean | string;
  disabled?: boolean | string;
}

export type FlowAction =
  | { type: 'submit'; actionId: string; successMessage?: string; errorMessage?: string }
  | { type: 'inputChange'; actionId: string; debounceMs?: number }
  | { type: 'update_state'; stateUpdates: Record<string, unknown>; successMessage?: string }
  | { type: 'close_screen'; finalMessage?: string }
  | { type: 'navigate'; target: string };

export interface SelectOption {
  label: string;
  value: string;
  icon?: string;
  disabled?: boolean;
  description?: string;
}

export interface FlowDefinition {
  version: '2.0';
  screenId: string;
  title?: string;
  components: FlowComponent[];
  data?: Record<string, unknown>;
  state: {
    values: Record<string, unknown>;
    touched: Record<string, boolean>;
    errors: Record<string, string>;
    submitting: boolean;
    submitted: boolean;
    history: string[];
    loadingComponentIds: string[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyState = (): FlowDefinition['state'] => ({
  values: {},
  touched: {},
  errors: {},
  submitting: false,
  submitted: false,
  history: [],
  loadingComponentIds: [],
});

/**
 * Convert the Markdown that LLMs naturally emit into the Slack-style "mrkdwn"
 * the flow UI's TextNode parser actually understands (it parses *bold*, _italic_,
 * ~strike~, `code`, <url|label> — NOT Markdown). Without this, agent text like
 * `**Title:**` renders the literal `**` in the flow card.
 *
 * Conversions (Markdown → mrkdwn):
 *   **bold** / __bold__   → *bold*
 *   ~~strike~~            → ~strike~
 *   [label](url)          → <url|label>
 *   # Heading             → *Heading*   (bold the line)
 *   -, *, + bullets       → •
 *
 * Deliberately does NOT touch single `*…*`: rewriting it to `_…_` would also
 * mangle the legitimate Slack `*bold*` that some builders already emit. A stray
 * Markdown `*italic*` then renders as Slack bold — visually off, but never the
 * broken literal `**`. Inline code and ``` fences are left untouched.
 */
export function mdToMrkdwn(input: string): string {
  if (!input) return input;
  // (code-span shield below uses a control-char sentinel, not spaces)
  // Shield code spans / fences so we don't rewrite syntax inside them.
  const spans: string[] = [];
  const guarded = input.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    spans.push(m);
    return `\u0000${spans.length - 1}\u0000`;
  });
  const out = guarded
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')            // **bold**  → *bold*
    .replace(/__([^_\n]+)__/g, '*$1*')                // __bold__  → *bold*
    .replace(/~~([^~\n]+)~~/g, '~$1~')                // ~~strike~~→ ~strike~
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<$2|$1>') // [label](url) → <url|label>
    .replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, '*$1*')    // # Heading → *Heading*
    .replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ');       // bullet → •
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)] ?? '');
}

// ── FlowBuilder ───────────────────────────────────────────────────────────────

export class FlowBuilder {
  private readonly _screenId: string;
  private _title?: string;
  private readonly _components: FlowComponent[] = [];
  private _data: Record<string, unknown> = {};

  constructor(screenId: string) {
    this._screenId = screenId;
  }

  setTitle(title: string): this {
    this._title = title;
    return this;
  }

  setData(data: Record<string, unknown>): this {
    this._data = { ...this._data, ...data };
    return this;
  }

  /**
   * Push a fully-formed component. Escape hatch for component types that have
   * no dedicated add* helper (e.g. the `plan` artifact, whose props are a
   * phase-discriminated union built by buildPlanFlow). Props are passed through
   * verbatim — the caller is responsible for matching the renderer's schema.
   */
  addComponent(component: FlowComponent): this {
    this._components.push(component);
    return this;
  }

  addText(
    id: string,
    content: string,
    opts?: {
      variant?: 'default' | 'muted' | 'success' | 'warning' | 'danger';
      bold?: boolean;
      size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
    },
  ): this {
    this._components.push({ id, type: 'text', props: { content: mdToMrkdwn(content), ...opts } });
    return this;
  }

  addHeading(id: string, content: string, level?: 1 | 2 | 3 | 4): this {
    this._components.push({ id, type: 'heading', props: { content: mdToMrkdwn(content), level: level ?? 2 } });
    return this;
  }

  addDivider(id: string): this {
    this._components.push({ id, type: 'divider' });
    return this;
  }

  addButton(
    id: string,
    label: string,
    action: FlowAction,
    opts?: { variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline'; size?: 'sm' | 'md' | 'lg' },
  ): this {
    this._components.push({ id, type: 'button', props: { label, action, ...opts } });
    return this;
  }

  addInput(
    id: string,
    name: string,
    opts?: {
      label?: string;
      placeholder?: string;
      type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
      required?: boolean;
      defaultValue?: string;
      helperText?: string;
    },
  ): this {
    this._components.push({ id, type: 'input', props: { name, ...opts } });
    return this;
  }

  addTextarea(
    id: string,
    name: string,
    opts?: { label?: string; placeholder?: string; rows?: number; required?: boolean; defaultValue?: string },
  ): this {
    this._components.push({ id, type: 'textarea', props: { name, ...opts } });
    return this;
  }

  addSelect(
    id: string,
    name: string,
    opts: {
      label?: string;
      options: SelectOption[];
      required?: boolean;
      defaultValue?: string;
      orientation?: 'horizontal' | 'vertical';
    },
  ): this {
    this._components.push({ id, type: 'select', props: { name, ...opts } });
    return this;
  }

  addDropdown(
    id: string,
    name: string,
    opts: {
      label?: string;
      placeholder?: string;
      options: SelectOption[];
      required?: boolean;
      action?: FlowAction;
    },
  ): this {
    this._components.push({ id, type: 'dropdown', props: { name, ...opts } });
    return this;
  }

  addRow(id: string, children: FlowComponent[], style?: FlowComponentStyle): this {
    this._components.push({ id, type: 'row', children, ...(style !== undefined ? { style } : {}) });
    return this;
  }

  addColumn(id: string, children: FlowComponent[], style?: FlowComponentStyle): this {
    this._components.push({ id, type: 'column', children, ...(style !== undefined ? { style } : {}) });
    return this;
  }

  addCard(id: string, children: FlowComponent[], style?: FlowComponentStyle): this {
    this._components.push({ id, type: 'card', children, ...(style !== undefined ? { style } : {}) });
    return this;
  }

  // ── Static helpers for building child components inline ─────────────────────

  static text(
    id: string,
    content: string,
    opts?: { variant?: 'default' | 'muted' | 'success' | 'warning' | 'danger'; bold?: boolean },
  ): FlowComponent {
    return { id, type: 'text', props: { content: mdToMrkdwn(content), ...opts } };
  }

  static button(
    id: string,
    label: string,
    action: FlowAction,
    opts?: { variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline' },
  ): FlowComponent {
    return { id, type: 'button', props: { label, action, ...opts } };
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  /**
   * Returns a FlowDefinition ready to pass as the `flow` field in
   * Spaces' postMessage API. chatController.ts wraps it into
   * <div data-flow-json="..."> automatically — no HTML construction needed.
   */
  build(): FlowDefinition {
    return {
      version: '2.0',
      screenId: this._screenId,
      ...(this._title !== undefined ? { title: this._title } : {}),
      components: this._components,
      ...(Object.keys(this._data).length > 0 ? { data: this._data } : {}),
      state: emptyState(),
    };
  }
}

// ── Pre-built Flow factories used by webhook.ts ───────────────────────────────

/**
 * An HMAC-signed pending write action, as produced by claw-auth's /actions/sign.
 * Rides in flowJSON.data so flow-action.ts can verify + execute it on approval.
 */
export interface WriteAction {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  signature: string;
  agentSlug: string;
  channelId?: string;
  conversationId?: string;
}

/**
 * The flowJSON.data payload flow-action's `actionType === "write"` branch reads.
 * SINGLE source of truth for this shape — every card that carries a signed write
 * action (generic approval card, agentCreation card, …) must build its data
 * here, so a new field can never be added to one card and missed on another.
 */
function writeActionData(action: WriteAction): Record<string, unknown> {
  return {
    actionType: 'write',
    serverType: action.serverType,
    tool: action.tool,
    params: JSON.stringify(action.params),
    userId: action.userId,
    signature: action.signature,
    agentSlug: action.agentSlug,
    ...(action.channelId !== undefined ? { channelId: action.channelId } : {}),
    ...(action.conversationId !== undefined ? { conversationId: action.conversationId } : {}),
  };
}

/**
 * Write tool approval — Approve/Decline buttons for HITL write actions.
 * Context data is stored in flowJSON.data so flow-action.ts can execute the tool.
 */
export function buildWriteApprovalFlow(
  actionDesc: string,
  action: WriteAction,
): FlowDefinition {
  return new FlowBuilder(`write-approval-${crypto.randomUUID()}`)
    .setTitle('Action Approval')
    .addText('intro', 'The agent wants to execute:', { variant: 'muted', size: 'sm' })
    // Description in a bordered card that scrolls past ~280px so a long ticket
    // body (Title/Description/bullets) never blows out the chat surface.
    // CardNode spreads `style` as raw inline CSS, so maxHeight/overflowY apply
    // with no renderer change.
    .addCard('desc', [FlowBuilder.text('desc-body', actionDesc)], {
      maxHeight: '280px',
      overflowY: 'auto',
    })
    .addRow('actions', [
      FlowBuilder.button('approve', '✓  Approve', { type: 'submit', actionId: 'approve-write', successMessage: 'Approved' }, { variant: 'primary' }),
      FlowBuilder.button('approve-continue', '✓  Approve & Continue', { type: 'submit', actionId: 'approve-continue', successMessage: 'Approved — continuing' }, { variant: 'secondary' }),
      FlowBuilder.button('decline', '✕  Decline', { type: 'submit', actionId: 'decline-write' }, { variant: 'destructive' }),
    ])
    .setData(writeActionData(action))
    .build();
}

/**
 * Write result card — replaces the approval card after the tool ran.
 * Success: a trimmed detail card (no buttons). Failure: an error card with
 * Retry / Retry & Continue buttons that re-submit the SAME HMAC-signed action
 * (params unchanged → signature still valid; flow-action.ts re-verifies).
 */
export function buildWriteResultFlow(opts: {
  tool: string;
  ok: boolean;
  heading: string;
  details: Array<{ label: string; value: string }>;
  errorText?: string;
  /** The same signed action, re-submitted verbatim by the Retry buttons
   *  (params unchanged → signature still valid). `tool` comes from opts.tool. */
  retry?: Omit<WriteAction, 'tool'> & { spacesAppId?: string };
}): FlowDefinition {
  const b = new FlowBuilder(`write-result-${crypto.randomUUID()}`)
    .setTitle(opts.ok ? 'Action Completed' : 'Action Failed')
    .addText('res-head', `${opts.ok ? '✅' : '❌'} ${opts.heading}`, {
      variant: opts.ok ? 'success' : 'danger',
      bold: true,
    });

  const cardChildren =
    opts.details.length > 0
      ? opts.details.map((d, i) => FlowBuilder.text(`res-d-${i}`, `**${d.label}:** ${d.value}`))
      : [FlowBuilder.text('res-d-0', opts.errorText ?? (opts.ok ? 'Done.' : 'The action did not complete.'))];

  b.addCard('res-card', cardChildren, { maxHeight: '280px', overflowY: 'auto' });

  if (!opts.ok && opts.retry) {
    b.addRow('res-actions', [
      FlowBuilder.button('retry', '↻  Retry', { type: 'submit', actionId: 'retry-write', successMessage: 'Retrying' }, { variant: 'primary' }),
      FlowBuilder.button('retry-continue', '↻  Retry & Continue', { type: 'submit', actionId: 'retry-continue', successMessage: 'Retrying' }, { variant: 'secondary' }),
    ]).setData({
      ...writeActionData({ ...opts.retry, tool: opts.tool }),
      ...(opts.retry.spacesAppId !== undefined ? { spacesAppId: opts.retry.spacesAppId } : {}),
    });
  }

  return b.build();
}

/**
 * Digital Twin approval — shows draft response + Approve/Decline + optional edit textarea.
 * Context data stored in flowJSON.data so flow-action.ts can post as the user.
 */
export interface TwinApprovalFlowParams {
  /** The Twin's structured proposal — react and/or reply, and where. */
  delivery: TwinDelivery;
  /** The message that triggered the Twin (the react target + display context). */
  sourceMessageId?: string;
  /** Origin channel + thread the mention came from (the default reply target). */
  targetChannelId: string;
  targetConversationId: string;
  mentionedUserId: string;
  workspaceId: string;
  /** The person who mentioned the user (display + dm_sender destination). */
  senderId?: string;
  senderName: string;
  channelName: string;
  /** The incoming message text (shown as context + paired for learning). */
  task: string;
  agentSlug?: string;
  dmChannelId?: string;
  spacesBaseUrl?: string;
}

/** Human label for a resolved reply destination, shown in the approval card. */
function twinDestinationLabel(
  dest: TwinReplyDestination | undefined,
  originChannelName: string,
  senderName: string,
): string {
  switch (dest?.kind) {
    case undefined:
    case "origin_thread": return "this thread";
    case "origin_channel": return `#${originChannelName} (new message)`;
    case "dm_sender": return `DM to ${senderName}`;
    case "dm": return `DM to ${dest.userName ?? "a teammate"}`;
    case "channel": return `#${dest.channelName ?? dest.channelId}`;
    case "thread": return `a thread in #${dest.channelName ?? dest.channelId}`;
  }
}

/**
 * Digital Twin approval DM. Renders the Twin's STRUCTURED proposal (react with
 * an emoji and/or reply, and where) — never raw assistant text — and, on Approve,
 * hands the delivery back to the flow-action handler which executes it as the
 * user. React targets the triggering message; a reply's destination defaults to
 * the origin thread and is shown explicitly when the Twin chose to reply elsewhere.
 */
export function buildTwinApprovalFlow(params: TwinApprovalFlowParams): FlowDefinition {
  const {
    delivery, sourceMessageId, targetChannelId, targetConversationId,
    mentionedUserId, workspaceId, senderId, senderName, channelName, task,
    agentSlug, dmChannelId, spacesBaseUrl,
  } = params;

  const willReact = delivery.action === "react" || delivery.action === "react_and_reply";
  const willReply = delivery.action === "reply" || delivery.action === "react_and_reply";
  const message = delivery.message ?? "";
  const dest = delivery.destination;
  const destLabel = twinDestinationLabel(dest, channelName, senderName);

  // Deep link back to the originating thread so the reviewer can open the full
  // context in one tap. Rendered as a Slack-mrkdwn link the TextNode parser
  // turns into an <a>. `spaces-tools.ts` uses the same /chat/dir/<ch>/<conv> path.
  const threadLink = spacesBaseUrl
    ? `\n\n<${spacesBaseUrl.replace(/\/+$/, '')}/chat/dir/${targetChannelId}/${targetConversationId}|↗ Open thread>`
    : '';

  // One-line summary of what Approve will do, so the reviewer sees intent at a glance.
  const planParts: string[] = [];
  if (willReact) planParts.push(`react ${delivery.emoji ?? ''}`.trim());
  if (willReply) planParts.push(`reply in *${destLabel}*`);
  const planLine = `*On approve:* ${planParts.join(' · ')}`;
  const reasonLine = willReply && dest && dest.kind !== 'origin_thread' && delivery.destinationReason
    ? `\n_Why here: ${delivery.destinationReason}_`
    : '';

  const b = new FlowBuilder(`twin-approval-${crypto.randomUUID()}`)
    .setTitle('Digital Twin Response')
    .addText('context', `*${senderName}* mentioned you in *#${channelName}*:\n> ${task}${threadLink}`)
    .addDivider('d1')
    .addText('plan', `${planLine}${reasonLine}`);

  // Editable body only when the Twin is actually posting a message.
  if (willReply) {
    b.addTextarea('edit', 'editedContent', { label: 'Proposed reply:', rows: 10 });
  }

  b.addDivider('d2')
    .addRow('actions', [
      FlowBuilder.button('approve', willReply ? 'Approve & Send' : 'Approve', { type: 'submit', actionId: 'twin-approve', successMessage: 'Done' }, { variant: 'primary' }),
      FlowBuilder.button('decline', 'Decline', { type: 'submit', actionId: 'twin-decline' }, { variant: 'destructive' }),
    ])
    .setData({
      actionType: 'twin-approval',
      targetChannelId,
      targetConversationId,
      mentionedUserId,
      workspaceId,
      // The reply body (the approve handler prefers the edited textarea value).
      messageContent: message,
      // Structured delivery — read back by the approve handler to execute react
      // and/or post-to-destination. Stored flat so it survives the flow JSON
      // round-trip through Spaces without nested-object surprises.
      deliveryAction: delivery.action,
      ...(delivery.emoji ? { deliveryEmoji: delivery.emoji } : {}),
      destinationKind: dest?.kind ?? 'origin_thread',
      ...(dest?.kind === 'channel' ? { destinationChannelId: dest.channelId, ...(dest.channelName ? { destinationChannelName: dest.channelName } : {}) } : {}),
      ...(dest?.kind === 'thread' ? { destinationChannelId: dest.channelId, destinationConversationId: dest.conversationId, ...(dest.channelName ? { destinationChannelName: dest.channelName } : {}) } : {}),
      // DM to a specific person: carry their userId so the approve handler can
      // open/resolve the DM channel. `dm_sender` needs nothing extra — it resolves
      // to the stored senderId at approve time.
      ...(dest?.kind === 'dm' ? { destinationUserId: dest.userId, ...(dest.userName ? { destinationUserName: dest.userName } : {}) } : {}),
      ...(delivery.destinationReason ? { destinationReason: delivery.destinationReason } : {}),
      ...(sourceMessageId ? { sourceMessageId } : {}),
      // Persist the incoming message + participants so the approve/decline
      // handlers can record the outcome for the daily learning loop.
      incomingTask: task,
      channelName,
      ...(senderId ? { senderId } : {}),
      ...(agentSlug ? { agentSlug } : {}),
      ...(dmChannelId ? { dmChannelId } : {}),
    });

  const flow = b.build();
  if (willReply) flow.state.values['editedContent'] = message;
  return flow;
}

/**
 * User question — radio group with the agent's options + submit button.
 */
export function buildUserQuestionFlow(
  question: string,
  options: string[],
  context: {
    questionId: string;
    agentSlug: string;
    channelId: string;
    conversationId: string;
    userId: string;
  },
): FlowDefinition {
  return new FlowBuilder(`user-question-${crypto.randomUUID()}`)
    .addText('q', question)
    .addSelect('answer', 'answer', {
      label: 'Choose an option',
      required: true,
      options: options.map((opt) => ({ label: opt, value: opt })),
    })
    .addButton('submit', 'Submit', { type: 'submit', actionId: 'user-answer' }, { variant: 'primary' })
    .setData({
      actionType: 'user-answer',
      questionId: context.questionId,
      agentSlug: context.agentSlug,
      channelId: context.channelId,
      conversationId: context.conversationId,
      userId: context.userId,
    })
    .build();
}

/**
 * Promote-provider — offer the user the agent's premium provider after the
 * default model (kimi/spaces) failed or soft-refused. Two-button card; tap
 * "Yes, retry with <provider>" → flow-action.ts:promote-provider sets the
 * conversation-scoped escalation flag and re-dispatches the original task
 * with the agent's premium credentials. "No" closes the card without state
 * change. Approval sticks for the lifetime of the conversation.
 *
 * Distinct from buildUserQuestionFlow because the response routing differs
 * (actionType = "promote-provider"), and we need to carry the provider name
 * + original task in flowJSON.data for the re-dispatch.
 */
export function buildPromoteProviderFlow(
  provider: string,
  context: {
    agentSlug: string;
    channelId: string;
    conversationId: string;
    userId: string;
    originalTask: string;
  },
): FlowDefinition {
  return new FlowBuilder(`promote-provider-${crypto.randomUUID()}`)
    .addText(
      'q',
      `⚠️ The default model couldn't complete this. Retry with **${provider}**? It will be used for the rest of this conversation.`,
    )
    .addButton(
      'accept',
      `Yes, retry with ${provider}`,
      { type: 'submit', actionId: 'promote-provider-accept', successMessage: 'Retrying…' },
      { variant: 'primary' },
    )
    .addButton(
      'decline',
      'No',
      { type: 'submit', actionId: 'promote-provider-decline' },
      { variant: 'secondary' },
    )
    .setData({
      actionType: 'promote-provider',
      provider,
      agentSlug: context.agentSlug,
      channelId: context.channelId,
      conversationId: context.conversationId,
      userId: context.userId,
      originalTask: context.originalTask,
    })
    .build();
}

/**
 * /goal suggestion — single-button card the agent proposes via the
 * suggest-goal tool. Tapping fires flow-action.ts:start-goal which
 * dispatches the same flow as a user typing `/goal <condition>`.
 *
 * The condition rides in flowJSON.data (not the visible rationale),
 * so multi-paragraph goals stay out of the chat surface. The card
 * collapses to a confirmation line after tap via
 * replaceFlowCardWithText so the user can't double-tap.
 */
export function buildGoalSuggestionFlow(
  rationale: string,
  context: {
    condition: string;
    agentSlug: string;
    channelId: string;
    conversationId: string;
    userId: string;
  },
): FlowDefinition {
  return new FlowBuilder(`goal-suggest-${crypto.randomUUID()}`)
    .addText('rationale', `**Suggested /goal:** ${rationale}`)
    .addText('hint', "_Tap to run this as an autonomous loop, or keep replying manually._", { variant: 'muted' })
    .addButton(
      'start',
      '▶ Run autonomously as /goal',
      { type: 'submit', actionId: 'start-goal', successMessage: 'Starting…' },
      { variant: 'primary' },
    )
    .setData({
      actionType: 'start-goal',
      condition: context.condition,
      agentSlug: context.agentSlug,
      channelId: context.channelId,
      conversationId: context.conversationId,
      userId: context.userId,
    })
    .build();
}

export function buildAgentCallProposalFlow(
  context: {
    proposerAgentSlug: string;
    proposerAgentName: string;
    targetAgentSlug: string;
    targetAgentName: string;
    task: string;
    why: string;
    conversationId: string;
    channelId: string;
    signature: string;
  },
): FlowDefinition {
  return new FlowBuilder(`agent-call-${crypto.randomUUID()}`)
    .setTitle('Agent Suggestion')
    .addText(
      'proposal',
      `🎯 **${context.proposerAgentName}** suggests **${context.targetAgentName}** — ${context.why}\n\nTask: ${context.task}`,
    )
    .addRow('actions', [
      FlowBuilder.button(
        'run',
        `Run ${context.targetAgentName}`,
        { type: 'submit', actionId: 'agent-call-run', successMessage: 'Starting…' },
        { variant: 'primary' },
      ),
      FlowBuilder.button(
        'dismiss',
        'Dismiss',
        { type: 'submit', actionId: 'agent-call-dismiss' },
        { variant: 'secondary' },
      ),
    ])
    .setData({
      actionType: 'agent-call',
      targetAgentSlug: context.targetAgentSlug,
      targetAgentName: context.targetAgentName,
      task: context.task,
      proposerAgentSlug: context.proposerAgentSlug,
      conversationId: context.conversationId,
      channelId: context.channelId,
      signature: context.signature,
    })
    .build();
}

export function buildConnectAccountFlow(context: {
  displayName: string;
  authUrl: string;
  reason?: string;
  serverType?: string;
}): FlowDefinition {
  return new FlowBuilder(`connect-account-${crypto.randomUUID()}`)
    .addComponent({
      id: 'connect-account',
      type: 'connectAccount',
      props: {
        displayName: context.displayName,
        authUrl: context.authUrl,
        ...(context.reason?.trim() ? { reason: context.reason.trim() } : {}),
        ...(context.serverType?.trim() ? { serverType: context.serverType.trim() } : {}),
      },
    })
    .setData({ actionType: 'connect-account' })
    .build();
}

export function buildMcpConfigureFlow(context: {
  serverType: string;
  serverName: string;
  mcpServerId: string;
  fields: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; optional?: boolean }>;
  reason?: string;
  userId: string;
  agentSlug?: string;
  spacesAppId?: string;
}): FlowDefinition {
  return new FlowBuilder(`mcp-configure-${context.serverType}-${crypto.randomUUID()}`)
    .addComponent({
      id: 'mcp-configure',
      type: 'mcpConfigure',
      props: {
        serverType: context.serverType,
        serverName: context.serverName,
        mcpServerId: context.mcpServerId,
        fields: context.fields.map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          ...(field.optional ? { optional: true } : {}),
        })),
        ...(context.reason?.trim() ? { reason: context.reason.trim() } : {}),
      },
    })
    .setData({
      actionType: 'mcp-configure',
      userId: context.userId,
      mcpServerId: context.mcpServerId,
      serverType: context.serverType,
      serverName: context.serverName,
      ...(context.agentSlug ? { agentSlug: context.agentSlug } : {}),
      ...(context.spacesAppId ? { spacesAppId: context.spacesAppId } : {}),
    })
    .build();
}

/**
 * create-agent HITL card — a single `agentCreation` node that updates IN PLACE
 * across phases (like the plan card), keyed on the SAME message:
 *
 *   pending  → proposed agent + Approve/Decline. The buttons (rendered by the
 *              node) submit the write-tool actionIds; the HMAC-signed action is
 *              carried in flowJSON.data (identical shape to buildWriteApprovalFlow)
 *              so the existing write persistence path runs unchanged.
 *   created  → approved. Created chip, prompt still expandable, setup hint.
 *   rejected → declined. Rejected chip.
 *
 * Rendered by apps/dashboard AgentCreationNode; validated by @xyne/shared
 * agentCreationComponentSchema (both must ship together — the dashboard rejects
 * an unknown component type). screenId is keyed on the slug so phase updates to
 * the same agent reconcile to the same card.
 */
/**
 * Derive the agentCreation card's display props from a create-agent tool's raw
 * params. Shared by the pending (webhook), created, and rejected (flow-action)
 * emit sites so the in-place card update always shows the same agent details.
 * Only present fields are assigned (no explicit `undefined`).
 */
/** The displayable fields of an agentCreation card, shared by all three phases. */
export interface AgentCreationCardProps {
  name: string;
  slug: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  tools?: string[];
  connectLinks?: Array<{ serverType: string; displayName: string; authUrl: string }>;
}

/** Trimmed non-empty string, or undefined. */
function trimmedOrUndefined(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

export function agentCreationPropsFromToolParams(params: Record<string, unknown>): AgentCreationCardProps {
  const name = trimmedOrUndefined(params['name']);
  // Mirror flow-action's create branch: an omitted slug derives from the name.
  const slug =
    trimmedOrUndefined(params['slug'])?.toLowerCase() ??
    name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  const description = trimmedOrUndefined(params['description']);
  const systemPrompt = trimmedOrUndefined(params['systemPrompt']);
  const modelId = trimmedOrUndefined(params['modelId']);
  const tools = Array.isArray(params['tools'])
    ? (params['tools'] as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];

  const props: AgentCreationCardProps = { name: name ?? 'Agent', slug: slug || 'agent' };
  if (description) props.description = description;
  if (systemPrompt) props.systemPrompt = systemPrompt;
  if (modelId) props.modelId = modelId;
  if (tools.length > 0) props.tools = tools;
  return props;
}

export function buildAgentCreationFlow(
  phase: 'pending' | 'created' | 'rejected',
  agent: AgentCreationCardProps & {
    note?: string;
    decidedBy?: string;
    decidedAt?: string;
  },
  action?: WriteAction,
): FlowDefinition {
  // Node props: phase + name/slug always; every other field only when non-empty
  // (the zod schema is .strict(), and empty strings would render as blank rows).
  const props: Record<string, unknown> = { phase, name: agent.name, slug: agent.slug };
  const optionalStringProps = ['description', 'systemPrompt', 'modelId', 'note', 'decidedBy', 'decidedAt'] as const;
  for (const field of optionalStringProps) {
    const value = agent[field]?.trim();
    if (value) props[field] = value;
  }
  if (agent.tools && agent.tools.length > 0) props['tools'] = agent.tools;
  if (agent.connectLinks && agent.connectLinks.length > 0) props['connectLinks'] = agent.connectLinks;

  const builder = new FlowBuilder(`agent-creation-${agent.slug}`)
    .setTitle('Agent')
    .addComponent({ id: 'agent-creation', type: 'agentCreation', props });

  // Pending carries the signed write action (the node's Approve/Decline buttons
  // submit the standard approve-write/decline-write actionIds against it);
  // decided phases have no action to run.
  builder.setData(phase === 'pending' && action ? writeActionData(action) : { actionType: `agent-${phase}` });
  return builder.build();
}

/** The displayable fields of a create-skill approval card. */
export interface SkillCreationCardProps {
  name: string;
  slug: string;
  description?: string;
  content?: string;
}

export function skillCreationPropsFromToolParams(params: Record<string, unknown>): SkillCreationCardProps {
  const name = trimmedOrUndefined(params['name']);
  const slug =
    trimmedOrUndefined(params['slug'])?.toLowerCase() ??
    name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const description = trimmedOrUndefined(params['description']);
  const content = trimmedOrUndefined(params['content']);

  const props: SkillCreationCardProps = { name: name ?? 'Skill', slug: slug || 'skill' };
  if (description) props.description = description;
  if (content) props.content = content;
  return props;
}

export function buildSkillCreationFlow(
  phase: 'pending' | 'created' | 'rejected',
  skill: SkillCreationCardProps & {
    note?: string;
    decidedBy?: string;
    decidedAt?: string;
  },
  action?: WriteAction,
): FlowDefinition {
  const props: Record<string, unknown> = { phase, name: skill.name, slug: skill.slug };
  const optionalStringProps = ['description', 'content', 'note', 'decidedBy', 'decidedAt'] as const;
  for (const field of optionalStringProps) {
    const value = skill[field]?.trim();
    if (value) props[field] = value;
  }

  const builder = new FlowBuilder(`skill-creation-${skill.slug}`)
    .setTitle('Skill')
    .addComponent({ id: 'skill-creation', type: 'skillCreation', props });

  builder.setData(phase === 'pending' && action ? writeActionData(action) : { actionType: `skill-${phase}` });
  return builder.build();
}

/**
 * Agent clone approval — raised when a viewer without owner/contributor
 * rights requests a clone. DM'd to the SOURCE agent's owner with
 * Approve / Decline buttons. Tapping Approve fires flow-action.ts's
 * `clone-approval` branch, which calls POST-equivalent logic to create the
 * clone for the requester; Decline just marks the request rejected.
 *
 * flowJSON.data carries:
 *   - requestId    : the AgentRequest row to resolve (authoritative)
 *   - ownerUserId  : intended reviewer (Spaces user id of the source owner);
 *                    flow-action fails closed unless callerUserId matches
 *   - agentSlug    : source agent — pins the app token used to edit the card
 */
export function buildCloneApprovalFlow(
  context: {
    requestId: string;
    ownerUserId: string;
    agentSlug: string;
    agentName: string;
    requesterName: string;
    spacesBaseUrl?: string;
  },
): FlowDefinition {
  const link = context.spacesBaseUrl
    ? `\n\n<${context.spacesBaseUrl.replace(/\/+$/, '')}/v3/agents/${context.agentSlug}|↗ View agent>`
    : '';
  return new FlowBuilder(`clone-approval-${crypto.randomUUID()}`)
    .setTitle('Clone Request')
    .addText(
      'intro',
      `*${context.requesterName}* wants to clone your agent *${context.agentName}*.\n\nA clone copies only the system prompt, tools, and skills into a new personal agent they own. Your app registration, credentials, and knowledge-base grants are NOT shared.${link}`,
    )
    .addDivider('d1')
    .addRow('actions', [
      FlowBuilder.button('approve', '✓  Approve', { type: 'submit', actionId: 'clone-approve', successMessage: 'Approved' }, { variant: 'primary' }),
      FlowBuilder.button('decline', '✕  Decline', { type: 'submit', actionId: 'clone-decline' }, { variant: 'destructive' }),
    ])
    .setData({
      actionType: 'clone-approval',
      requestId: context.requestId,
      ownerUserId: context.ownerUserId,
      agentSlug: context.agentSlug,
    })
    .build();
}

/**
 * Skill-update approval — raised by the `update-skill` tool. DM'd to the
 * skill's OWNER (or, for global skills, an admin) with the unified diff of the
 * proposed change and Approve / Decline buttons. Tapping Approve fires
 * flow-action.ts's `skill-update` branch, which re-fetches the request +
 * skill, re-checks ownership + content integrity, and applies the update;
 * Decline marks the request rejected.
 *
 * The card carries ONLY `requestId` as authoritative state — the diff/content
 * live in the SkillChangeRequest row so a large markdown body never travels in
 * the (signed) card and can't be tampered with client-side. `approverUserId`
 * is included solely for the fail-closed caller check; flow-action re-reads the
 * real approver from the DB.
 */
/** Rendering caps for the git-style diff card. FlowJSON has no native diff
 *  component, so each line is its own styled text node — cap the totals so a
 *  full-file rewrite can't emit thousands of components. */
const DIFF_CARD_MAX_HUNKS = 6;
const DIFF_CARD_MAX_LINES = 60;
const DIFF_LINE_MAX_CHARS = 160;

/**
 * Skill-update approval — raised by the `update-skill` tool, DM'd to the
 * skill's owner. Git-style rendering (2026-07-15 redesign): header + stat
 * chips, one-line summary, per-hunk cards with green/red line highlighting,
 * an explicit SHRINK WARNING when the proposal deletes far more than it adds
 * (the guard that would have flagged the truncated-tool-args incident), and
 * Approve/Decline. The card still carries ONLY `requestId` as authoritative
 * state — content/diff live server-side on the request row.
 */
export function buildSkillUpdateApprovalFlow(
  context: {
    requestId: string;
    approverUserId: string;
    skillSlug: string;
    skillName: string;
    proposerName: string;
    /** Structured diff (computeSkillDiff). Preferred over diffText. */
    diff?: { hunks: Array<{ header: string; lines: Array<{ kind: 'ctx' | 'add' | 'del'; text: string }> }>; added: number; removed: number };
    /** Legacy fallback: preformatted fenced diff text. Used when `diff` absent. */
    diffText?: string;
    summary?: string;
    agentSlug?: string;
    /** Unique app id — lets the /action handler resolve the agent token
     *  unambiguously (agentSlug alone is ambiguous for global/multi-org
     *  agents, so the card could never be collapsed after approve/decline). */
    spacesAppId?: string;
    spacesBaseUrl?: string;
  },
): FlowDefinition {
  let diff = context.diff;
  let truncated = false;
  if (diff && diff.hunks.length > 0) {
    let linesUsed = 0;
    const hunks: typeof diff.hunks = [];
    for (const hunk of diff.hunks) {
      if (hunks.length >= DIFF_CARD_MAX_HUNKS || linesUsed >= DIFF_CARD_MAX_LINES) { truncated = true; break; }
      const lines: typeof hunk.lines = [];
      for (const line of hunk.lines) {
        if (linesUsed >= DIFF_CARD_MAX_LINES) { truncated = true; break; }
        const text = line.text.length > DIFF_LINE_MAX_CHARS ? `${line.text.slice(0, DIFF_LINE_MAX_CHARS)}…` : line.text;
        lines.push({ ...line, text });
        linesUsed++;
      }
      hunks.push({ header: hunk.header, lines });
    }
    diff = { ...diff, hunks };
  }

  const props: Record<string, unknown> = {
    phase: 'pending',
    skillName: context.skillName,
    skillSlug: context.skillSlug,
    proposerName: context.proposerName,
  };
  if (context.summary?.trim()) props['summary'] = context.summary.trim();
  if (diff && diff.hunks.length > 0) props['diff'] = diff;
  if (!diff && context.diffText?.trim()) props['diffText'] = context.diffText.trim();
  if (truncated) props['truncated'] = true;

  return new FlowBuilder(`skill-update-${context.skillSlug}`)
    .setTitle('Skill Update Request')
    .addComponent({ id: 'skill-update', type: 'skillUpdate', props })
    .setData({
      actionType: 'skill-update',
      requestId: context.requestId,
      approverUserId: context.approverUserId,
      skillSlug: context.skillSlug,
      ...(context.agentSlug ? { agentSlug: context.agentSlug } : {}),
      ...(context.spacesAppId ? { spacesAppId: context.spacesAppId } : {}),
    })
    .build();
}

/**
 * Agent- / subagent-update approval — raised by the `update-agent` /
 * `update-subagent` tools and DM'd to the definition's owner. Emits ONE
 * `entityUpdate` node (rendered by the dashboard's EntityUpdateNode, shared by
 * both kinds) in phase 'pending'; flow-action.ts flips the SAME card to
 * 'approved' / 'rejected' in place on the owner's decision.
 *
 * The systemPrompt diff and scalar "Field changes" ship as STRUCTURED props —
 * presentation lives entirely in the renderer. The diff is capped here for
 * display (`truncated`); the FULL proposed content is stored on the request and
 * applied exactly as reviewed via the integrity hash. `kind` drives the labels
 * and the actionType / actionIds the owner's click routes to (`agent-update` /
 * `subagent-update`, resolved in flow-action.ts).
 */
export function buildEntityUpdateApprovalFlow(
  context: {
    kind: 'agent' | 'subagent';
    requestId: string;
    approverUserId: string;
    /** slug (agent) or name (subagent) of the target definition. */
    targetKey: string;
    /** Display name shown in the heading. */
    targetName: string;
    proposerName: string;
    /** systemPrompt diff (computeSkillDiff). Omit when only scalars changed. */
    diff?: { hunks: Array<{ header: string; lines: Array<{ kind: 'ctx' | 'add' | 'del'; text: string }> }>; added: number; removed: number };
    /** Unused by the node renderer; kept for signature compatibility. */
    diffText?: string;
    /** Changed scalar fields, rendered as a compact "Field changes" list. */
    fieldChanges?: Array<{ label: string; from: string; to: string }>;
    summary?: string;
    /** The posting agent's slug (for card collapse after approve/decline). */
    agentSlug?: string;
    spacesAppId?: string;
    spacesBaseUrl?: string;
  },
): FlowDefinition {
  const kindLabel = context.kind === 'agent' ? 'Agent' : 'Subagent';
  const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

  // Cap the SHIPPED diff — messages should stay small and the renderer bounded.
  let diff: { added: number; removed: number; hunks: Array<{ header: string; lines: Array<{ kind: 'ctx' | 'add' | 'del'; text: string }> }> } | undefined;
  let truncated = false;
  if (context.diff) {
    const hunks: NonNullable<typeof diff>['hunks'] = [];
    let linesUsed = 0;
    for (const hunk of context.diff.hunks) {
      if (hunks.length >= DIFF_CARD_MAX_HUNKS || linesUsed >= DIFF_CARD_MAX_LINES) { truncated = true; break; }
      const lines = hunk.lines.slice(0, DIFF_CARD_MAX_LINES - linesUsed);
      if (lines.length < hunk.lines.length) truncated = true;
      linesUsed += lines.length;
      hunks.push({ header: hunk.header, lines });
    }
    diff = { added: context.diff.added, removed: context.diff.removed, hunks };
  }

  const props: Record<string, unknown> = {
    phase: 'pending',
    kind: context.kind,
    targetName: context.targetName,
    targetKey: context.targetKey,
    proposerName: context.proposerName,
  };
  if (context.summary?.trim()) props['summary'] = clip(context.summary.trim(), 300);
  if (context.fieldChanges && context.fieldChanges.length > 0) {
    props['fieldChanges'] = context.fieldChanges.map((fc) => ({
      label: fc.label,
      from: clip(fc.from, 120),
      to: clip(fc.to, 120),
    }));
  }
  if (diff) props['diff'] = diff;
  if (truncated) props['truncated'] = true;

  return new FlowBuilder(`${context.kind}-update-${crypto.randomUUID()}`)
    .setTitle(`${kindLabel} Update Request`)
    .addComponent({ id: 'entity-update', type: 'entityUpdate', props })
    .setData({
      actionType: `${context.kind}-update`,
      requestId: context.requestId,
      approverUserId: context.approverUserId,
      targetKey: context.targetKey,
      ...(context.agentSlug ? { agentSlug: context.agentSlug } : {}),
      ...(context.spacesAppId ? { spacesAppId: context.spacesAppId } : {}),
    })
    .build();
}
