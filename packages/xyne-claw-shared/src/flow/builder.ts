/**
 * FlowBuilder — fluent builder for FlowUI v2.0 definitions.
 *
 * Used by xyne-claw-auth (webhook result handler) and xyne-claw (agent runtime).
 *
 * Types are inlined here to avoid adding @xyne/shared as a runtime dependency
 * in xyne-claw-shared. They mirror @xyne/shared/types/flowUI exactly.
 */

import type { TwinDelivery, TwinReplyDestination } from "../types/twin-delivery.js";
import type { UserQuestion } from "../tools/types.js";

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
  | 'agent'
  | 'agent_summary'
  | 'mcp_suggest'
  | 'mcpConfigure'
  | 'pr'
  | 'user_question'
  | 'code'
  | 'diff'
  | 'ticket'
  | 'chart';

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
 * Write tool approval — Approve/Decline buttons for HITL write actions.
 * Context data is stored in flowJSON.data so flow-action.ts can execute the tool.
 */
export function buildWriteApprovalFlow(
  actionDesc: string,
  action: {
    serverType: string;
    tool: string;
    params: Record<string, unknown>;
    userId: string;
    signature: string;
    agentSlug: string;
    channelId?: string;
    conversationId?: string;
  },
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
    .setData({
      actionType: 'write',
      serverType: action.serverType,
      tool: action.tool,
      params: JSON.stringify(action.params),
      userId: action.userId,
      signature: action.signature,
      agentSlug: action.agentSlug,
      ...(action.channelId !== undefined ? { channelId: action.channelId } : {}),
      ...(action.conversationId !== undefined ? { conversationId: action.conversationId } : {}),
    })
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
  retry?: {
    serverType: string;
    params: Record<string, unknown>;
    userId: string;
    signature: string;
    agentSlug: string;
    channelId?: string;
    conversationId?: string;
    spacesAppId?: string;
  };
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
      actionType: 'write',
      serverType: opts.retry.serverType,
      tool: opts.tool,
      params: JSON.stringify(opts.retry.params),
      userId: opts.retry.userId,
      signature: opts.retry.signature,
      agentSlug: opts.retry.agentSlug,
      ...(opts.retry.channelId !== undefined ? { channelId: opts.retry.channelId } : {}),
      ...(opts.retry.conversationId !== undefined ? { conversationId: opts.retry.conversationId } : {}),
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
  questions: UserQuestion[],
  context: {
    questionId: string;
    agentSlug: string;
    channelId: string;
    conversationId: string;
    userId: string;
  },
  opts?: {
    phase?: 'pending' | 'answered' | 'declined';
    answers?: Record<string, string | string[]>;
    notes?: Record<string, string>;
    decidedAt?: string;
  },
): FlowDefinition {
  const phase = opts?.phase ?? 'pending';
  return new FlowBuilder(`user-question-${context.questionId}`)
    .addComponent({
      id: 'questions',
      type: 'user_question',
      props: {
        title: questions.length === 1 ? 'Question' : 'Questions',
        questions,
        phase,
        ...(opts?.answers ? { answers: opts.answers } : {}),
        ...(opts?.notes ? { notes: opts.notes } : {}),
        ...(opts?.decidedAt ? { decidedAt: opts.decidedAt } : {}),
        ...(phase === 'pending' ? {
          submitAction: { type: 'submit', actionId: 'user-answer' },
          dismissAction: { type: 'submit', actionId: 'dismiss-user-question' },
        } : {}),
      },
    })
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
 * /goal suggestion — single-button card the agent proposes via the
 * suggest-goal tool. Tapping fires flow-action.ts:start-goal which
 * dispatches the same flow as a user typing `/goal <condition>`.
 *
 * The condition rides in flowJSON.data (not the visible rationale),
 * so multi-paragraph goals stay out of the chat surface. The card
 * collapses to a confirmation line after tap via
 * replaceFlowCardWithText so the user can't double-tap.
 */
/**
 * Capacity-retry card. Posted after a run dies because the model provider is
 * over capacity. Tells the user the run will be retried automatically once the model is serving again, and offers
 * a manual "Retry now" plus a "Stop" that deschedules the poller.
 *
 * Primitive components only, so it renders on the deployed dashboard with no
 * schema change. `retryToken` lets the handlers find + deschedule the pending
 * poller job.
 */
export function buildCapacityRetryFlow(
  provider: string,
  context: {
    agentSlug: string;
    channelId: string;
    conversationId: string;
    userId: string;
    retryToken: string;
    /** "pending" (auto-retry scheduled), "exhausted" (gave up after the cap),
     *  "cancelled", or "retrying" (a retry is in flight). Chooses the copy and
     *  whether the buttons survive. */
    phase?: 'pending' | 'retrying' | 'exhausted' | 'cancelled';
  },
): FlowDefinition {
  const phase = context.phase ?? 'pending';
  const b = new FlowBuilder(`capacity-retry-${context.retryToken}`);

  if (phase === 'pending') {
    b.addText('q', `⚠️ **${provider}** is over capacity right now, so this didn't complete. I'll retry automatically as soon as it's serving again (checking every few minutes for up to ~3 hours). You don't need to do anything — or tap **Retry now** to try immediately.`);
    b.addButton('now', 'Retry now', { type: 'submit', actionId: 'capacity-retry-now', successMessage: 'Retrying…' }, { variant: 'primary' });
    b.addButton('cancel', 'Stop retrying', { type: 'submit', actionId: 'capacity-retry-cancel' }, { variant: 'secondary' });
  } else if (phase === 'retrying') {
    b.addText('q', `▶ **${provider}** is back — retrying now.`, { variant: 'success' });
  } else if (phase === 'exhausted') {
    b.addText('q', `⚠️ **${provider}** is still over capacity after ~3 hours of retries. Tap **Retry now** to try again, or send your request later.`);
    b.addButton('now', 'Retry now', { type: 'submit', actionId: 'capacity-retry-now', successMessage: 'Retrying…' }, { variant: 'primary' });
  } else {
    b.addText('q', `Auto-retry stopped. Mention me again when you're ready to retry.`, { variant: 'muted' });
  }

  return b
    .setData({
      actionType: 'capacity-retry',
      provider,
      retryToken: context.retryToken,
      phase,
      agentSlug: context.agentSlug,
      channelId: context.channelId,
      conversationId: context.conversationId,
      userId: context.userId,
    })
    .build();
}

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

/**
 * Feedback options for buildFeedbackFlow. `value` is the machine value
 * captured on click; `sentiment` optionally maps the choice onto the run's
 * up/down rating signal (AgentRun.rating).
 */
export interface FeedbackOptionDef {
  label: string;
  value: string;
  sentiment?: 'up' | 'down';
}

/**
 * Collect-feedback — a configurable button row an agent posts after a run
 * (e.g. an RCA agent asking "Was this RCA correct?"). Each button captures a
 * `value`; tapping fires flow-action.ts's `collect-feedback` branch, which
 * verifies the caller and records the choice on the run's rating signal
 * (AgentRun.rating / ratingComment). When the agent supplies no options the
 * caller passes the built-in 👍 / 👎 default.
 *
 * Mirrors buildUserQuestionFlow's shape — agent-supplied options, HMAC-bound
 * routing carried in flowJSON.data, and an answered-phase collapse so the card
 * can't be tapped twice. Primitive components only (text + buttons), so it
 * renders on the deployed dashboard with no Spaces flow-schema change.
 *
 * Each button carries its choice in the actionId (`collect-feedback:<value>`)
 * because FlowAction submits are distinguished by actionId, not a value field.
 *
 * The `fallbackText` in setData is the stored-message preview — the "fallback
 * node" every rich card flow carries (see buildCodeFlow/buildDiffFlow/
 * buildChartFlow). Without it the persisted chat preview degrades to the
 * literal "Flow JSON".
 */
export function buildFeedbackFlow(
  prompt: string,
  options: FeedbackOptionDef[],
  context: {
    feedbackId: string;
    sessionId: string;
    agentSlug: string;
    channelId: string;
    conversationId: string;
    userId: string;
    signature?: string;
  },
  opts?: {
    phase?: 'pending' | 'answered';
    chosenLabel?: string;
    decidedAt?: string;
  },
): FlowDefinition {
  const phase = opts?.phase ?? 'pending';
  const b = new FlowBuilder(`collect-feedback-${context.feedbackId}`).setTitle('Feedback');

  if (phase === 'answered') {
    b.addText('prompt', prompt, { variant: 'muted' });
    b.addText('chosen', `✅ Thanks — you chose **${opts?.chosenLabel ?? ''}**`, { variant: 'success' });
  } else {
    b.addText('prompt', prompt);
    b.addRow(
      'actions',
      options.map((option, index) =>
        FlowBuilder.button(
          `fb-${index}`,
          option.label,
          {
            type: 'submit',
            actionId: `collect-feedback:${option.value}`,
            successMessage: 'Thanks for the feedback!',
          },
          { variant: index === 0 ? 'primary' : 'secondary' },
        ),
      ),
    );
  }

  return b
    .setData({
      actionType: 'collect-feedback',
      kind: 'feedback',
      fallbackText: `Feedback: ${prompt}`,
      feedbackId: context.feedbackId,
      sessionId: context.sessionId,
      agentSlug: context.agentSlug,
      channelId: context.channelId,
      conversationId: context.conversationId,
      userId: context.userId,
      options,
      ...(opts?.decidedAt ? { decidedAt: opts.decidedAt } : {}),
      ...(context.signature ? { signature: context.signature } : {}),
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
      `*${context.requesterName}* wants to clone your agent *${context.agentName}*.\n\nApproving gives them a personal copy carrying its prompt, tools, skills, behaviour settings and knowledge-base grants. Your app registration and your saved integration credentials are NOT shared — they will have to connect their own.${link}`,
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
/** Rendering caps for the skill-update diff card, which predates the native
 *  `diff` component and still renders each line as its own styled text node —
 *  cap the totals so a full-file rewrite can't emit thousands of components.
 *  New callers should emit a `diff` component (buildDiffFlow) instead. */
const DIFF_CARD_MAX_HUNKS = 6;
const DIFF_CARD_MAX_LINES = 60;
const DIFF_LINE_MAX_CHARS = 160;

/** mrkdwn-neutralize a raw diff line so `*`/`_`/backticks in skill content
 *  don't format-bomb the card. Zero-width-space after each marker keeps the
 *  visible text identical while defeating the parser. */
function neutralizeMrkdwn(line: string): string {
  return line.replace(/([*_~`])/g, "$1​");
}

function diffLineComponent(id: string, kind: 'ctx' | 'add' | 'del', text: string): FlowComponent {
  const clipped = text.length > DIFF_LINE_MAX_CHARS ? `${text.slice(0, DIFF_LINE_MAX_CHARS)}…` : text;
  const prefix = kind === 'add' ? '+ ' : kind === 'del' ? '− ' : '  ';
  const style: FlowComponentStyle =
    kind === 'add'
      ? { backgroundColor: 'rgba(46,160,67,0.15)', borderLeft: '3px solid #2ea043', padding: '1px 8px' }
      : kind === 'del'
        ? { backgroundColor: 'rgba(248,81,73,0.15)', borderLeft: '3px solid #f85149', padding: '1px 8px' }
        : { padding: '1px 8px', borderLeft: '3px solid transparent' };
  return {
    id,
    type: 'text',
    // Bypass mdToMrkdwn (FlowBuilder.text would convert) — diff content must
    // render verbatim, so neutralize markers instead.
    props: { content: prefix + neutralizeMrkdwn(clipped), size: 'sm', ...(kind === 'ctx' ? { variant: 'muted' } : {}) },
    style,
  };
}

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
  const b = new FlowBuilder(`skill-update-${crypto.randomUUID()}`)
    .setTitle('Skill Update Request')
    .addHeading('title', `Skill update: ${context.skillName}`, 3);

  const stats = context.diff ? `  ·  *+${context.diff.added}* / *−${context.diff.removed}*  ·  ${context.diff.hunks.length} hunk${context.diff.hunks.length === 1 ? '' : 's'}` : '';
  b.addText('meta', `proposed by *${context.proposerName}* on \`${context.skillSlug}\`${stats}`, { variant: 'muted', size: 'sm' });

  if (context.summary) {
    b.addText('summary', `*Summary:* ${context.summary.length > 300 ? `${context.summary.slice(0, 300)}…` : context.summary}`);
  }

  // Shrink warning — a proposal that deletes much more than it adds is the
  // signature of truncated tool arguments (a "full replacement" that lost its
  // tail), which destroyed a 318-rule skill on 2026-07-15. Make it unmissable.
  if (context.diff && context.diff.removed > 30 && context.diff.removed > context.diff.added * 3) {
    b.addCard('shrink-warning', [
      FlowBuilder.text(
        'shrink-warning-text',
        `⚠️ *This update REMOVES ${context.diff.removed} lines but adds only ${context.diff.added}.* If the proposer claimed a "full replacement", the content may have been truncated — verify the tail of the skill before approving.`,
        { variant: 'danger' },
      ),
    ], { border: '1px solid #f85149', borderRadius: '6px', padding: '8px' });
  }

  b.addDivider('d1');

  if (context.diff && context.diff.hunks.length > 0) {
    let linesUsed = 0;
    let hunksRendered = 0;
    let truncated = false;
    for (const [hi, hunk] of context.diff.hunks.entries()) {
      if (hunksRendered >= DIFF_CARD_MAX_HUNKS || linesUsed >= DIFF_CARD_MAX_LINES) { truncated = true; break; }
      const children: FlowComponent[] = [
        { id: `h${hi}-header`, type: 'text', props: { content: hunk.header, variant: 'muted', size: 'xs' }, style: { padding: '2px 8px' } },
      ];
      for (const [li, line] of hunk.lines.entries()) {
        if (linesUsed >= DIFF_CARD_MAX_LINES) { truncated = true; break; }
        children.push(diffLineComponent(`h${hi}-l${li}`, line.kind, line.text));
        linesUsed++;
      }
      b.addCard(`hunk-${hi}`, children, {
        border: '1px solid rgba(128,128,128,0.25)',
        borderRadius: '6px',
        padding: '4px 0',
        margin: '4px 0',
        maxHeight: '320px',
        overflowY: 'auto',
      });
      hunksRendered++;
    }
    if (truncated) {
      b.addText('diff-truncated', `_… diff truncated for display (showing ${linesUsed} lines across ${hunksRendered} hunks). The FULL proposed content is stored on the request and applied exactly as reviewed by the integrity hash._`, { variant: 'muted', size: 'sm' });
    }
  } else if (context.diffText) {
    b.addText('diff', context.diffText);
  }

  b.addDivider('d2')
    .addRow('actions', [
      FlowBuilder.button('approve', '✓  Approve', { type: 'submit', actionId: 'skill-update-approve', successMessage: 'Approved' }, { variant: 'primary' }),
      FlowBuilder.button('decline', '✕  Decline', { type: 'submit', actionId: 'skill-update-decline' }, { variant: 'destructive' }),
    ])
    .setData({
      actionType: 'skill-update',
      requestId: context.requestId,
      approverUserId: context.approverUserId,
      skillSlug: context.skillSlug,
      ...(context.agentSlug ? { agentSlug: context.agentSlug } : {}),
      ...(context.spacesAppId ? { spacesAppId: context.spacesAppId } : {}),
    });
  return b.build();
}

/**
 * MCP configure card — the agent needs an account the user hasn't connected, so
 * it posts this instead of failing or guessing.
 *
 * CREDENTIALS NEVER PASS THROUGH THE AGENT. This describes which inputs to
 * render; the user types them in the dashboard and the values go browser →
 * claw-auth. A tool that accepted credentials as arguments would write them into
 * the model's context, the run transcript and the logs.
 *
 * Rendered by apps/dashboard McpConfigureNode, validated by @xyne/shared
 * mcpConfigureComponentSchema — all three must ship together, since an unknown
 * component type is rejected at Spaces' postMessage ingest.
 */
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

const CODE_ARTIFACT_MAX_CHARS = 20_000;

function clipArtifact(body: string, marker: string): string {
  return body.length > CODE_ARTIFACT_MAX_CHARS
    ? `${body.slice(0, CODE_ARTIFACT_MAX_CHARS)}\n${marker}`
    : body;
}

export function buildCodeFlow(code: string, language?: string): FlowDefinition {
  const lineCount = code.split('\n').length;
  return new FlowBuilder(`code-${crypto.randomUUID()}`)
    .addComponent({
      id: 'code',
      type: 'code',
      props: {
        code: clipArtifact(code, '… truncated'),
        ...(language ? { language } : {}),
      },
    })
    // Without fallbackText the stored message preview degrades to the literal
    // "Flow JSON" — see the fallback chain in apps/backend chatController.
    .setData({
      kind: 'code',
      fallbackText: `${language ? `${language} ` : ''}snippet · ${lineCount} line${lineCount === 1 ? '' : 's'}`,
    })
    .build();
}

export function buildDiffFlow(path: string, patch: string): FlowDefinition {
  const firstMeaningfulLine = patch.split('\n').find((line) => line.trim() !== '') ?? '';
  const headed =
    firstMeaningfulLine.startsWith('diff --git ') || firstMeaningfulLine.startsWith('--- ');
  const headedPatch = headed ? patch : `--- a/${path}\n+++ b/${path}\n${patch}`;
  const lines = patch.split('\n');
  const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  return new FlowBuilder(`diff-${crypto.randomUUID()}`)
    .addComponent({
      id: 'diff',
      type: 'diff',
      props: {
        path,
        patch: clipArtifact(headedPatch, ' … diff truncated'),
      },
    })
    .setData({ kind: 'diff', fallbackText: `${path} · +${added}/−${removed}` })
    .build();
}

export interface TicketArtifact {
  xyneId: string;
  ticketId?: string;
  title: string;
  status: 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  stageName?: string;
  eta?: string;
  url: string;
  channelId?: string;
  conversationId?: string;
  assigneeId?: string;
}

export function buildTicketFlow(ticket: TicketArtifact): FlowDefinition {
  return new FlowBuilder(`ticket-${ticket.xyneId}`)
    .addComponent({
      id: 'ticket',
      type: 'ticket',
      props: {
        phase: 'created',
        xyneId: ticket.xyneId,
        ...(ticket.ticketId ? { ticketId: ticket.ticketId } : {}),
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        ...(ticket.stageName ? { stageName: ticket.stageName } : {}),
        ...(ticket.eta ? { eta: ticket.eta } : {}),
        ...(ticket.channelId ? { channelId: ticket.channelId } : {}),
        ...(ticket.conversationId ? { conversationId: ticket.conversationId } : {}),
        ...(ticket.assigneeId ? { assigneeId: ticket.assigneeId } : {}),
        url: ticket.url,
      },
    })
    .build();
}

export function buildTicketProposalFlow(
  ticket: {
    title: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    eta?: string;
    assigneeId?: string;
  },
  action: {
    serverType: string;
    tool: string;
    params: Record<string, unknown>;
    userId: string;
    signature: string;
    agentSlug: string;
    channelId?: string;
    conversationId?: string;
  },
): FlowDefinition {
  return new FlowBuilder(`ticket-proposal-${crypto.randomUUID()}`)
    .addComponent({
      id: 'ticket',
      type: 'ticket',
      props: {
        phase: 'proposed',
        title: ticket.title,
        status: 'TODO',
        priority: ticket.priority ?? 'MEDIUM',
        ...(ticket.eta ? { eta: ticket.eta } : {}),
        ...(ticket.assigneeId ? { assigneeId: ticket.assigneeId } : {}),
        approveAction: { type: 'submit', actionId: 'approve-write', successMessage: 'Approved' },
        approveContinueAction: { type: 'submit', actionId: 'approve-continue', successMessage: 'Approved — continuing' },
        declineAction: { type: 'submit', actionId: 'decline-write' },
      },
    })
    .setData({
      actionType: 'write',
      serverType: action.serverType,
      tool: action.tool,
      params: JSON.stringify(action.params),
      userId: action.userId,
      signature: action.signature,
      agentSlug: action.agentSlug,
      ...(action.channelId !== undefined ? { channelId: action.channelId } : {}),
      ...(action.conversationId !== undefined ? { conversationId: action.conversationId } : {}),
    })
    .build();
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSeriesPoint {
  x: string;
  y: number;
  series?: string;
}

export type ChartArtifact =
  | { type: 'bar'; points: ChartPoint[]; caption?: string }
  | { type: 'pie'; points: ChartPoint[]; caption?: string }
  | { type: 'donut'; points: ChartPoint[]; caption?: string }
  | { type: 'line'; series: ChartSeriesPoint[]; caption?: string }
  | { type: 'area'; series: ChartSeriesPoint[]; caption?: string };

const CHART_MAX_CATEGORY_POINTS = 24;
const CHART_MAX_SERIES_POINTS = 200;

export function buildChartFlow(chart: ChartArtifact): FlowDefinition {
  let props: Record<string, unknown>;
  let pointCount: number;
  if (chart.type === 'line' || chart.type === 'area') {
    const series = chart.series.slice(0, CHART_MAX_SERIES_POINTS);
    props = { type: chart.type, series };
    pointCount = series.length;
  } else {
    const points = chart.points.slice(0, CHART_MAX_CATEGORY_POINTS);
    props = { type: chart.type, points };
    pointCount = points.length;
  }
  return new FlowBuilder(`chart-${crypto.randomUUID()}`)
    .addComponent({
      id: 'chart',
      type: 'chart',
      props: { ...props, ...(chart.caption ? { caption: chart.caption } : {}) },
    })
    // The caption carries the takeaway, so it's the best preview line we have;
    // fall back to the shape when the agent omitted one.
    .setData({
      kind: 'chart',
      fallbackText: chart.caption?.trim()
        ? chart.caption.trim()
        : `${chart.type} chart · ${pointCount} point${pointCount === 1 ? '' : 's'}`,
    })
    .build();
}

export interface McpSuggestConnector {
  serverType: string;
  name: string;
  description?: string;
  connected?: boolean;
}

/**
 * Connector suggestions posted into a conversation.
 *
 * Rows carry display data only. The dashboard node resolves the live server id
 * from the catalog when Connect is pressed, so a card that has been sitting in
 * a thread cannot act on a connector that has since changed.
 */
export function buildMcpSuggestFlow(context: {
  connectors: McpSuggestConnector[];
  title?: string;
  reason?: string;
  browseAll?: boolean;
  totalCount?: number;
  screenKey: string;
  agentSlug?: string;
  userId: string;
  conversationId?: string;
  channelId?: string;
}): FlowDefinition {
  return new FlowBuilder(`mcp-suggest-${context.screenKey}`)
    .addComponent({
      id: 'mcp-suggest',
      type: 'mcp_suggest',
      props: {
        ...(context.title ? { title: context.title } : {}),
        ...(context.reason ? { reason: context.reason } : {}),
        ...(context.browseAll ? { browseAll: true } : {}),
        ...(context.totalCount !== undefined ? { totalCount: context.totalCount } : {}),
        connectors: context.connectors.map((c) => ({
          serverType: c.serverType,
          name: c.name,
          ...(c.description ? { description: c.description } : {}),
          ...(c.connected !== undefined ? { connected: c.connected } : {}),
        })),
      },
    })
    .setData({
      actionType: 'mcp-suggest',
      ...(context.agentSlug ? { agentSlug: context.agentSlug } : {}),
      userId: context.userId,
      ...(context.conversationId ? { conversationId: context.conversationId } : {}),
      ...(context.channelId ? { channelId: context.channelId } : {}),
    })
    .build();
}
