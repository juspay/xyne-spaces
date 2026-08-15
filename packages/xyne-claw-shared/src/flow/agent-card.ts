/**
 * Agent card — ONE FlowUI v2.0 `agent` component that renders every agent
 * surface (dashboard: components/flowUI/nodes/AgentNode.tsx).
 *
 * The identity block (name / slug / description / model / capabilities / system
 * prompt) is INVARIANT across variants — that identity IS the artifact. The
 * `variant` discriminates only the chrome:
 *
 *   draft   → the agent does NOT exist yet. `phase` walks pending → created |
 *             rejected on the SAME message: post once via Spaces
 *             postMessage({ flow }), then updateMessage({ flowJSON }) with the
 *             same screenId + component id, exactly like the plan card.
 *   profile → a live agent, read-only.
 *
 * Adding a surface = adding a UNION BRANCH (existing emitters keep validating).
 * Presentational key/value rows go in `identity.details` and need no schema
 * change at all; only making a field EDITABLE earns a new branch.
 *
 * ── The props/data split (load-bearing) ──────────────────────────────────────
 * `props` is PRESENTATION ONLY. Every identifier the server acts on — requestId,
 * agentSlug, the user allowed to act, routing — lives in `flowJSON.data`, which
 * flow-action.ts reads. The whole flowJSON round-trips through the browser on
 * every action, so props are untrusted input: the approve path re-reads the
 * draft from its AgentRequest row and never persists what the card carried.
 *
 * Source-of-truth schema + zod validation: @xyne/shared
 * shared/src/validation/flowSchema.ts (`agentComponentSchema`). Both must ship
 * before an emitter goes live — apps/backend validates every posted flow, so an
 * unknown component type is a 400 at postMessage, not a blank card.
 */

import { FlowBuilder, type FlowComponent, type FlowDefinition } from './builder.js';

/** Stable component id — the `state.values` key the node reads/writes and the
 *  key flow-action.ts reads the user's capability selection from. Do NOT change
 *  without updating both consumers. */
export const AGENT_COMPONENT_ID = 'agent';

/** Display cap for the system prompt carried on the card. The card copy is for
 *  the expanded view only — the FULL prompt lives in the AgentRequest row and is
 *  what actually gets created, so truncating here is purely cosmetic. */
const MAX_CARD_PROMPT = 20_000;
const MAX_DESC = 500;
const MAX_CAPABILITIES = 60;
const MAX_DETAILS = 12;

export interface AgentCapability {
  /** Subagent name or custom tool slug — the identifier config.tools stores. */
  id: string;
  label: string;
  kind: 'subagent' | 'tool';
  /** MCP serverType whose brand icon represents this capability, e.g. "github". */
  iconKey?: string;
  /** serverType whose account/credentials this capability needs, when unconnected. */
  requiresConnection?: string;
}

export interface AgentDetailRow {
  label: string;
  value: string;
}

export interface AgentConnectLink {
  serverType: string;
  displayName: string;
  authUrl: string;
}

export interface AgentIdentity {
  name: string;
  slug: string;
  /** Handle credited under the name ("Built by @fractal-agent"). */
  builtBy?: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  color?: string;
  capabilities?: AgentCapability[];
  details?: AgentDetailRow[];
  connectLinks?: AgentConnectLink[];
}

export type AgentDraftPhase = 'pending' | 'created' | 'rejected';

export type AgentCardProps =
  | {
      variant: 'draft';
      phase: AgentDraftPhase;
      agent: AgentIdentity;
      /** Seeds state.values[AGENT_COMPONENT_ID] — capability ids kept by the user. */
      selected?: string[];
      note?: string;
      decidedBy?: string;
      /** User id of the decider — the card renders their avatar. */
      decidedById?: string;
      decidedAt?: string;
    }
  | { variant: 'profile'; agent: AgentIdentity; note?: string };

/** Routing + server-truth identifiers. Read by flow-action.ts; never by the node. */
export interface AgentCardData {
  /** Draft cards: the AgentRequest row this card decides. */
  requestId?: string;
  /**
   * The agent that POSTED this card — its Spaces app token is what updates the
   * message. Keyed `agentSlug` because every flow-action branch resolves the
   * poster from exactly that key; the card's SUBJECT is `targetSlug`.
   */
  agentSlug: string;
  /** Profile cards: the live agent this card describes. */
  targetSlug?: string;
  /** The ONLY user allowed to act on this card (fail-closed in flow-action). */
  userId: string;
  conversationId?: string;
  channelId?: string;
}

const trimmed = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max)}\n\n…(truncated for display)` : t;
};

/**
 * Normalize an identity into the exact shape `agentIdentitySchema` accepts.
 *
 * THE reuse hinge: the draft path (from a propose-agent spec) and the profile
 * path (from a persisted row) both funnel through here, so the two surfaces can
 * never drift. Empty/blank fields are DROPPED rather than emitted as "" — the
 * zod props schema is .strict() and blank strings render as empty rows.
 */
export function agentIdentity(input: {
  name: string;
  slug: string;
  builtBy?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  modelId?: string | null;
  color?: string | null;
  capabilities?: AgentCapability[];
  details?: AgentDetailRow[];
  connectLinks?: AgentConnectLink[];
}): AgentIdentity {
  const identity: AgentIdentity = {
    name: trimmed(input.name, 120) ?? 'Agent',
    slug: trimmed(input.slug, 80) ?? 'agent',
  };

  // Stored without the leading "@" — the renderer adds it, so the value stays a
  // plain handle wherever else it is used.
  const builtBy = trimmed(input.builtBy, 80)?.replace(/^@+/, "");
  if (builtBy) identity.builtBy = builtBy;
  const description = trimmed(input.description, MAX_DESC);
  if (description) identity.description = description;
  const systemPrompt = trimmed(input.systemPrompt, MAX_CARD_PROMPT);
  if (systemPrompt) identity.systemPrompt = systemPrompt;
  const modelId = trimmed(input.modelId, 120);
  if (modelId) identity.modelId = modelId;
  const color = trimmed(input.color, 32);
  if (color) identity.color = color;

  const capabilities = (input.capabilities ?? [])
    .filter((c) => c.id.trim().length > 0 && c.label.trim().length > 0)
    .slice(0, MAX_CAPABILITIES)
    .map((c) => ({
      id: c.id.trim(),
      label: c.label.trim(),
      kind: c.kind,
      ...(c.iconKey ? { iconKey: c.iconKey } : {}),
      ...(c.requiresConnection ? { requiresConnection: c.requiresConnection } : {}),
    }));
  if (capabilities.length > 0) identity.capabilities = capabilities;

  const details = (input.details ?? [])
    .filter((d) => d.label.trim().length > 0)
    .slice(0, MAX_DETAILS)
    .map((d) => ({ label: d.label.trim(), value: d.value.trim() }));
  if (details.length > 0) identity.details = details;

  if (input.connectLinks && input.connectLinks.length > 0) {
    identity.connectLinks = input.connectLinks;
  }

  return identity;
}

/**
 * Is the `agent` component type live on the Spaces/dashboard side?
 *
 * apps/backend validates EVERY posted flow against @xyne/shared's strict
 * discriminated union (chatController → validateFlowDefinition), so emitting
 * `type: "agent"` before that half ships is a 400 VALIDATION_ERROR at
 * postMessage — the message never appears at all, rather than degrading to a
 * blank card. claw-auth deploys independently of the dashboard, so the emitter
 * must not assume they move together.
 *
 * Default OFF: the fallback below renders the same card out of primitives that
 * have shipped for months. Flip SPACES_SUPPORTS_AGENT_CARD=true once
 * agentComponentSchema + AgentNode are deployed. Same pattern as
 * SPACES_SUPPORTS_AGENT_PROGRESS in webhook.ts.
 */
function agentComponentSupported(): boolean {
  return process.env["SPACES_SUPPORTS_AGENT_CARD"] === "true";
}

/** "**Model:** claude-opus-5" style rows, skipping anything absent. */
function identityLines(agent: AgentIdentity): string[] {
  const lines: string[] = [];
  if (agent.builtBy) lines.push(`Built by @${agent.builtBy}`);
  if (agent.description) lines.push(agent.description);
  if (agent.modelId) lines.push(`**Model:** ${agent.modelId}`);
  for (const row of agent.details ?? []) lines.push(`**${row.label}:** ${row.value}`);
  return lines;
}

/**
 * The same card built from primitives (heading/text/multiselect/button) that
 * the deployed dashboard already renders.
 *
 * Two things must match the real component exactly or the round trip breaks:
 *   - the capability picker is `name: AGENT_COMPONENT_ID`, because FlowUI keys
 *     state.values by props.name (CheckboxNode) and flow-action.ts reads
 *     values[AGENT_COMPONENT_ID] to learn which capabilities the user kept;
 *   - the button actionIds are the two flow-action.ts accepts verbatim
 *     (agent-draft-approve / agent-draft-decline); anything else is a 400.
 * `data` is set by the caller below, so authorization and routing are identical
 * on both paths.
 */
function buildAgentCardFallback(props: AgentCardProps, screenKey: string): FlowBuilder {
  const b = new FlowBuilder(`agent-card-${screenKey}`);
  const agent = props.agent;

  b.addHeading('name', agent.name, 3);
  b.addText('slug', `\`@${agent.slug}\``, { variant: 'muted', size: 'sm' });
  const lines = identityLines(agent);
  if (lines.length > 0) b.addText('identity', lines.join('\n\n'));

  const capabilities = agent.capabilities ?? [];
  const isPendingDraft = props.variant === 'draft' && props.phase === 'pending';

  if (capabilities.length > 0) {
    if (isPendingDraft) {
      // Editable on the pending draft — unchecking a capability is how the user
      // removes it before approving.
      b.addComponent({
        id: AGENT_COMPONENT_ID,
        type: 'multiselect',
        props: {
          name: AGENT_COMPONENT_ID,
          label: 'Capabilities',
          options: capabilities.map((c) => ({ label: c.label, value: c.id })),
          defaultValue: props.selected ?? capabilities.map((c) => c.id),
        },
      });
    } else {
      b.addText('capabilities', `**Capabilities:** ${capabilities.map((c) => c.label).join(', ')}`);
    }
  }

  for (const link of agent.connectLinks ?? []) {
    b.addText(`connect-${link.serverType}`, `Connect **${link.displayName}**: ${link.authUrl}`, {
      variant: 'warning',
      size: 'sm',
    });
  }

  if (props.variant === 'draft') {
    if (props.phase === 'pending') {
      b.addDivider('d1');
      b.addButton(
        'agent-draft-approve',
        'Create agent',
        { type: 'submit', actionId: 'agent-draft-approve', successMessage: 'Creating…' },
        { variant: 'primary' },
      );
      b.addButton(
        'agent-draft-decline',
        'Discard',
        { type: 'submit', actionId: 'agent-draft-decline', successMessage: 'Discarded' },
        { variant: 'secondary' },
      );
    } else {
      // Terminal phases carry no buttons — the decision already happened, and a
      // live button here would let a stale card re-submit it.
      const who = props.decidedBy ? ` by ${props.decidedBy}` : '';
      b.addText(
        'outcome',
        props.phase === 'created' ? `✅ Agent created${who}.` : `Discarded${who}.`,
        { variant: props.phase === 'created' ? 'success' : 'muted' },
      );
    }
  }

  if (props.note) b.addText('note', props.note, { variant: 'muted', size: 'sm' });
  return b;
}

/**
 * Build the agent card as a single `agent` component. Deterministic (pure) so
 * every phase/variant re-render produces a byte-stable card the client can
 * reconcile in place. screenId is keyed on the card's server identity so phase
 * updates for the same draft land on the same screen.
 *
 * Falls back to primitive components until the dashboard ships the `agent`
 * node — see agentComponentSupported().
 */
export function buildAgentCardFlow(props: AgentCardProps, data: AgentCardData): FlowDefinition {
  const componentProps: Record<string, unknown> =
    props.variant === 'draft'
      ? {
          variant: 'draft',
          phase: props.phase,
          agent: props.agent,
          // Default the selection to EVERY capability: an unchecked chip means
          // "the user removed it", so an absent seed must not read as "user
          // deselected everything".
          selected: props.selected ?? (props.agent.capabilities ?? []).map((c) => c.id),
          ...(props.note ? { note: props.note } : {}),
          ...(props.decidedBy ? { decidedBy: props.decidedBy } : {}),
          ...(props.decidedById ? { decidedById: props.decidedById } : {}),
          ...(props.decidedAt ? { decidedAt: props.decidedAt } : {}),
        }
      : {
          variant: 'profile',
          agent: props.agent,
          ...(props.note ? { note: props.note } : {}),
        };

  const component: FlowComponent = { id: AGENT_COMPONENT_ID, type: 'agent', props: componentProps };
  const screenKey = data.requestId ?? data.targetSlug ?? props.agent.slug;

  // No title: FlowRenderer paints `flowJSON.title` as an <h2> ABOVE the card, and
  // a bare "Agent" heading over a card whose first line is the agent's name is
  // pure duplication. The card names itself.
  const builder = agentComponentSupported()
    ? new FlowBuilder(`agent-card-${screenKey}`).addComponent(component)
    : buildAgentCardFallback(props, screenKey);

  // setData is IDENTICAL on both paths — flow-action.ts authorizes and routes
  // purely from here, so the fallback is not a second security surface.
  return builder
    .setData({
      actionType: 'agent-card',
      variant: props.variant,
      ...(data.requestId ? { requestId: data.requestId } : {}),
      agentSlug: data.agentSlug,
      ...(data.targetSlug ? { targetSlug: data.targetSlug } : {}),
      userId: data.userId,
      ...(data.conversationId ? { conversationId: data.conversationId } : {}),
      ...(data.channelId ? { channelId: data.channelId } : {}),
    })
    .build();
}
