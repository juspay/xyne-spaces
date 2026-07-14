/**
 * FlowBuilder — fluent builder for FlowUI v2.0 definitions.
 *
 * Used by xyne-claw-auth (webhook result handler) and xyne-claw (agent runtime).
 *
 * Types are inlined here to avoid adding @xyne/shared as a runtime dependency
 * in xyne-claw-shared. They mirror @xyne/shared/types/flowUI exactly.
 */

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
  | 'link';

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
    })
    .build();
}

/**
 * Digital Twin approval — shows draft response + Approve/Decline + optional edit textarea.
 * Context data stored in flowJSON.data so flow-action.ts can post as the user.
 */
export function buildTwinApprovalFlow(
  result: string,
  targetChannelId: string,
  targetConversationId: string,
  mentionedUserId: string,
  workspaceId: string,
  senderName: string,
  channelName: string,
  task: string,
  agentSlug?: string,
  dmChannelId?: string,
  spacesBaseUrl?: string,
): FlowDefinition {
  // Deep link back to the originating thread so the reviewer can open the full
  // context in one tap. Rendered as a Slack-mrkdwn link the TextNode parser
  // turns into an <a>. `spaces-tools.ts` uses the same /chat/dir/<ch>/<conv> path.
  const threadLink = spacesBaseUrl
    ? `\n\n<${spacesBaseUrl.replace(/\/+$/, '')}/chat/dir/${targetChannelId}/${targetConversationId}|↗ Open thread>`
    : '';
  const flow = new FlowBuilder(`twin-approval-${crypto.randomUUID()}`)
    .setTitle('Digital Twin Response')
    .addText('context', `*${senderName}* mentioned you in *#${channelName}*:\n> ${task}${threadLink}`)
    .addDivider('d1')
    .addTextarea('edit', 'editedContent', {
      label: 'Proposed response:',
      rows: 10,
    })
    .addDivider('d2')
    .addRow('actions', [
      FlowBuilder.button('approve', 'Approve & Send', { type: 'submit', actionId: 'twin-approve', successMessage: 'Sent' }, { variant: 'primary' }),
      FlowBuilder.button('decline', 'Decline', { type: 'submit', actionId: 'twin-decline' }, { variant: 'destructive' }),
    ])
    .setData({
      actionType: 'twin-approval',
      targetChannelId,
      targetConversationId,
      mentionedUserId,
      workspaceId,
      messageContent: result,
      // Persist the incoming message + channel so the approve handler can pair
      // (incoming → the user's final reply) and feed it to the twin's memory
      // learning loop. Display-only fields elsewhere; these are read back.
      incomingTask: task,
      channelName,
      ...(agentSlug ? { agentSlug } : {}),
      ...(dmChannelId ? { dmChannelId } : {}),
    })
    .build();
  flow.state.values['editedContent'] = result;
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
