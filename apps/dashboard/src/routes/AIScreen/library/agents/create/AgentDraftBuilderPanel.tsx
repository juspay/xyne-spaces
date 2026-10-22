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
import { buildHiddenContext } from './agentBuilderPrompt';
import { bareToolSlug, paramsToDraftPatch, type DraftPatchContext } from './agentDraftPatch';
import { BUILDER_DRIVER_SLUG } from '../detail/AgentBuilderPanel';

const KICKOFF_QUERY = 'Help me set up an agent';

const DRAFT_TOOLS = new Set(['create-agent', 'update-agent']);

const APPROVE_ACTIONS = new Set(['approve-write', 'approve-continue']);

const AGENT_CARD_APPROVE = 'agent-draft-approve';

const UPDATE_AGENT_TOOL = 'update-agent';

function patchContextFor(tool: string, saved: WizardState | null): DraftPatchContext {
  if (tool !== UPDATE_AGENT_TOOL) return {};
  return {
    toolsIntent: 'merge',
    ...(saved ? { anchorPrompt: saved.systemPrompt } : {}),
  };
}

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
  onApplyPatch: (patch: Partial<WizardState>) => void;
  onBusyChange?: (busy: boolean) => void;
  onAgentCreated?: (slug: string) => void;
  createdSlug?: string | null;
  savedAgent?: Agent | undefined;
  onRequestSave?: () => Promise<void>;
}

export function AgentDraftBuilderPanel({
  draft,
  onApplyPatch,
  onBusyChange,
  onAgentCreated,
  createdSlug,
  savedAgent,
  onRequestSave,
}: AgentDraftBuilderPanelProps): ReactElement {
  const { data: catalog, isPending: catalogPending } = useClawAvailableTools();

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const createdSlugRef = useRef(createdSlug);
  createdSlugRef.current = createdSlug;

  const openedOnSavedAgent = useRef(createdSlug !== null && createdSlug !== undefined);
  const seed = useMemo(
    () =>
      catalogPending || openedOnSavedAgent.current
        ? null
        : { query: KICKOFF_QUERY, nonce: Date.now() },
    [catalogPending],
  );

  const savedState = useMemo(
    () => (savedAgent ? wizardStateFromAgent(savedAgent) : null),
    [savedAgent],
  );
  const savedStateRef = useRef<WizardState | null>(savedState);
  savedStateRef.current = savedState;

  const seenCardsRef = useRef<Set<string>>(new Set());

  const hiddenContext = useCallback(
    () =>
      buildHiddenContext(
        draftRef.current,
        catalogRef.current,
        createdSlugRef.current,
        savedStateRef.current,
      ),
    [],
  );

  const applyProposal = useCallback(
    (params: Record<string, unknown>, context: DraftPatchContext = {}): void => {
      const { patch, problems } = paramsToDraftPatch(
        params,
        draftRef.current,
        catalogRef.current,
        context,
      );

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
      const tool = bareToolSlug(action.tool);
      if (!DRAFT_TOOLS.has(tool)) return false;
      if (approved) applyProposal(action.params, patchContextFor(tool, savedStateRef.current));
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
        return typeof data['tool'] === 'string' && DRAFT_TOOLS.has(bareToolSlug(data['tool']));
      },
      hidesCard: (): boolean => true,
      onCardSeen: (flow: FlowDefinition): void => {
        if (seenCardsRef.current.has(flow.screenId)) return;
        seenCardsRef.current.add(flow.screenId);

        const cardParams = agentCardParams(flow);
        if (cardParams) {
          applyProposal(cardParams);
          return;
        }

        const data = flow.data ?? {};
        const tool = typeof data['tool'] === 'string' ? bareToolSlug(data['tool']) : '';
        if (!DRAFT_TOOLS.has(tool)) return;
        const params = parseFlowParams(data['params']);
        if (params) applyProposal(params, patchContextFor(tool, savedStateRef.current));
      },
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
          const slug = effectiveSlug(draftRef.current);
          if (slug) onAgentCreated?.(slug);
          return;
        }
        if (!APPROVE_ACTIONS.has(actionId)) return;
        void onRequestSave?.().catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : 'Could not save this agent');
        });
      },
    }),
    [applyProposal, onAgentCreated, onRequestSave],
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
            emptyStateTitle='What would you like to create today?'
            emptyStateSubtitle='Describe the job and I’ll set the agent up on the left.'
            composerPlaceholder={
              createdSlug ? 'Ask Xyne AI to update this agent…' : 'Describe the agent you want…'
            }
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
