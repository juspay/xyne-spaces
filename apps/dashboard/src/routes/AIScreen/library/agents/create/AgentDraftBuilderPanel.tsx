import { useCallback, useMemo, useRef, type ReactElement } from 'react';
import type { AgentDraftProps, FlowDefinition } from '@xyne/shared';
import { toast } from 'sonner';
import XyneAISidebar from '@/components/Chat/XyneAISidebar/XyneAISidebar';
import type { PendingAction } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import { FlowDraftScopeContext, type FlowDraftScope } from '@/components/flowUI/FlowContext';
import { EDITS_STATE_KEY } from '@/components/flowUI/nodes/agent/useDraftAgentEditor';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { effectiveSlug, type WizardState } from '../../../../ClawAgentsScreen/create/wizardState';
import { wizardStateFromAgent } from './agentDraft';
import { buildHiddenContext, buildSeedQuery } from './agentBuilderPrompt';
import { bareToolSlug, paramsToDraftPatch } from './agentDraftPatch';
import { BUILDER_DRIVER_SLUG } from '../detail/AgentBuilderPanel';

const DRAFT_TOOLS = new Set(['create-agent', 'update-agent']);

const APPROVE_ACTIONS = new Set(['approve-write', 'approve-continue']);

const AGENT_CARD_APPROVE = 'agent-draft-approve';

function agentCardParams(flow: FlowDefinition): Record<string, unknown> | null {
  const props = flow.components.find(component => component.type === 'agent')?.props as
    | AgentDraftProps
    | undefined;
  if (!props || props.variant !== 'draft') return null;

  const { agent, toolSelection } = props;
  const selected = [
    ...(toolSelection?.subagents ?? []),
    ...(toolSelection?.direct ?? []),
    ...(toolSelection?.custom ?? []),
    ...(toolSelection?.gateway ?? []),
  ];
  const tools = selected.length > 0 ? selected : (agent.capabilities ?? []).map(c => c.id);

  return {
    name: agent.name,
    slug: agent.slug,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.color ? { color: agent.color } : {}),
    ...(agent.systemPrompt ? { systemPrompt: agent.systemPrompt } : {}),
    tools,
  };
}

function parseFlowParams(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface AgentDraftBuilderPanelProps {
  draft: WizardState;
  intent: string;
  onApplyPatch: (patch: Partial<WizardState>) => void;
  onBusyChange?: (busy: boolean) => void;
  /** The draft card created this agent. The setup screen switches from creating
   *  to editing it, so further changes update rather than create a second one. */
  onAgentCreated?: (slug: string) => void;
  /** Set once the agent exists. Switches the agent from proposing a new agent
   *  to updating this one — propose-agent can only fail on a taken handle. */
  createdSlug?: string | null;
  /** The agent as STORED. update-agent anchors its prompt edits against this,
   *  so the agent has to be shown it rather than the form's copy. */
  savedAgent?: Agent | undefined;
}

export function AgentDraftBuilderPanel({
  draft,
  intent,
  onApplyPatch,
  onBusyChange,
  onAgentCreated,
  createdSlug,
  savedAgent,
}: AgentDraftBuilderPanelProps): ReactElement {
  const { data: catalog, isPending: catalogPending } = useClawAvailableTools();

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const intentRef = useRef(intent);
  intentRef.current = intent;

  const seed = useMemo(
    () =>
      catalogPending
        ? null
        : { query: buildSeedQuery(draftRef.current, intentRef.current), nonce: Date.now() },
    [catalogPending],
  );

  const createdSlugRef = useRef(createdSlug);
  createdSlugRef.current = createdSlug;

  // Through a ref like the rest: useSaveClawAgent reseeds the detail cache on
  // save, so this follows the stored agent without the context going stale.
  // Memoised because this panel re-renders on every streamed token, and the
  // conversion walks the agent's tools, skills and knowledge each time.
  const savedState = useMemo(
    () => (savedAgent ? wizardStateFromAgent(savedAgent) : null),
    [savedAgent],
  );
  const savedStateRef = useRef<WizardState | null>(savedState);
  savedStateRef.current = savedState;

  const seenCardsRef = useRef<Set<string>>(new Set());

  // Read through refs, not captured values: this runs per message, so the
  // instructions flip from proposing to updating as soon as the agent exists.
  const hiddenContext = useCallback(
    () =>
      buildHiddenContext(
        draftRef.current,
        intentRef.current,
        catalogRef.current,
        createdSlugRef.current,
        savedStateRef.current,
      ),
    [],
  );

  const applyProposal = useCallback(
    (params: Record<string, unknown>): void => {
      const { patch, problems } = paramsToDraftPatch(params, draftRef.current, catalogRef.current);

      // Every one of these says something the agent asked for did NOT make it
      // onto the draft, while its own reply usually claims success. They have
      // to be dismissed, not time out unseen.
      problems.forEach(problem => toast.warning(problem, { duration: Infinity }));

      if (Object.keys(patch).length === 0) {
        if (problems.length === 0) toast.info('Nothing in that proposal applied to the draft');
        return;
      }

      onApplyPatch(patch);
    },
    [onApplyPatch],
  );

  const onInterceptPendingAction = useCallback(
    (action: PendingAction, approved: boolean): boolean => {
      if (!DRAFT_TOOLS.has(bareToolSlug(action.tool))) return false;
      if (approved) applyProposal(action.params);
      return true;
    },
    [applyProposal],
  );

  const draftScope = useMemo<FlowDraftScope>(
    () => ({
      claims: (flow: FlowDefinition): boolean => {
        const data = flow.data ?? {};
        if (data['actionType'] === 'agent-card' && data['variant'] === 'draft') return true;
        if (data['actionType'] !== 'write') return false;
        // update-agent too: after creation the agent edits through it, and the
        // change has to land on the form rather than write straight through.
        return typeof data['tool'] === 'string' && DRAFT_TOOLS.has(bareToolSlug(data['tool']));
      },
      onCardSeen: (flow: FlowDefinition): void => {
        // Once per card, for the life of the panel. The card remounts when it
        // settles, and re-applying then would put the original proposal back
        // over the agent that was just created from it.
        if (seenCardsRef.current.has(flow.screenId)) return;
        seenCardsRef.current.add(flow.screenId);
        const params = agentCardParams(flow);
        if (params) applyProposal(params);
      },
      // What the server creates from. Without this it builds from the spec it
      // stored when the card was posted, so everything the user changed on the
      // form between the proposal and pressing Create Agent is thrown away.
      valuesForSubmit: (flow: FlowDefinition, actionId: string): Record<string, unknown> | null => {
        if (actionId !== AGENT_CARD_APPROVE || agentCardParams(flow) === null) return null;
        const draft = draftRef.current;
        return {
          [EDITS_STATE_KEY]: {
            name: draft.name.trim(),
            slug: effectiveSlug(draft),
            description: draft.description.trim(),
            systemPrompt: draft.systemPrompt.trim(),
            toolSelection: {
              subagents: draft.tools.subagents,
              direct: draft.tools.direct,
              gateway: draft.tools.gateway,
              custom: draft.tools.custom,
              callableAgents: draft.tools.callableAgents,
            },
          },
        };
      },
      onApplied: (actionId: string, flow: FlowDefinition): void => {
        if (actionId === AGENT_CARD_APPROVE) {
          if (agentCardParams(flow) === null) return;
          // Already on the draft from onCardSeen — re-applying here would undo
          // anything the user changed before approving. Only reached once the
          // server accepted, so the agent exists: hand the screen its slug.
          //
          // The FORM's slug, not the card's. valuesForSubmit sent it as the
          // retyped identity, so it is what was created — and the two differ
          // the moment the user renames the agent before approving.
          const slug = effectiveSlug(draftRef.current);
          if (slug) onAgentCreated?.(slug);
          return;
        }
        if (!APPROVE_ACTIONS.has(actionId)) return;
        const params = parseFlowParams((flow.data ?? {})['params']);
        if (params) applyProposal(params);
      },
    }),
    [applyProposal, onAgentCreated],
  );

  return (
    <div className='agent-builder-pane flex h-full min-h-0 flex-col border-l border-border bg-background'>
      <div className='min-h-0 flex-1'>
        <FlowDraftScopeContext.Provider value={draftScope}>
          <XyneAISidebar
            channelId={null}
            variant='sidebar'
            forcedAgentSlug={BUILDER_DRIVER_SLUG}
            startFreshChat
            initialQuery={seed?.query ?? ''}
            {...(seed ? { autoSendNonce: seed.nonce } : {})}
            hiddenContext={hiddenContext}
            onInterceptPendingAction={onInterceptPendingAction}
            {...(onBusyChange ? { onStreamingChange: onBusyChange } : {})}
            composerPlaceholder='Ask Xyne AI to update this agent…'
            showAgentHeader
            hideAgentName
            roomyContent
            hideEmptyStateSuggestions
            hideHeader
            hideHeaderClose
            hideBackgroundStreamNotice
          />
        </FlowDraftScopeContext.Provider>
      </div>
    </div>
  );
}
