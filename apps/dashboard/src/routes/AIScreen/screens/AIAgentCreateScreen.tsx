import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { useLocation } from 'react-router-dom';
import { AIShell } from '../../../components/AIScreen/AIShell';
import ClawAgentCreateV2 from '../library/agents/create/ClawAgentCreateV2';
import { AgentDraftBuilderPanel } from '../library/agents/create/AgentDraftBuilderPanel';
import {
  INITIAL_WIZARD_STATE,
  slugify,
  type WizardState,
} from '../../ClawAgentsScreen/create/wizardState';
import { useAIChatHandoff } from '../useAIChatHandoff';
import { useClawAgentDetail } from '../../../hooks/useClawAgentDetail';
import { wizardStateFromAgent } from '../library/agents/create/agentDraft';

export interface AgentDraftSeed {
  name?: string;
  intent?: string;
  color?: string;
}

function seededDraft(seed: AgentDraftSeed | undefined): WizardState {
  if (!seed) return INITIAL_WIZARD_STATE;
  const name = seed.name?.trim() ?? '';
  return {
    ...INITIAL_WIZARD_STATE,
    ...(name ? { name, slug: slugify(name) } : {}),
    ...(seed.color ? { color: seed.color } : {}),
  };
}

const AIAgentCreateScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();
  const location = useLocation();
  const seed = (location.state as { draftSeed?: AgentDraftSeed } | null)?.draftSeed;

  const [draft, setDraft] = useState<WizardState>(() => seededDraft(seed));
  const applyPatch = useCallback((patch: Partial<WizardState>) => {
    setDraft(prev => ({ ...prev, ...patch }));
  }, []);

  const [instructionsPatchNonce, setInstructionsPatchNonce] = useState(0);
  const applyAiPatch = useCallback((patch: Partial<WizardState>) => {
    setDraft(prev => ({ ...prev, ...patch }));
    if (patch.systemPrompt !== undefined) setInstructionsPatchNonce(n => n + 1);
  }, []);

  const [aiBusy, setAiBusy] = useState(false);

  // The draft card creates the agent, so this screen only ever creates through
  // it. Once it has, we stay put — the conversation that built the agent is
  // alongside — and switch the form over to editing the real thing.
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const {
    data: createdAgent,
    isError: createdAgentFailed,
    refetch: refetchCreatedAgent,
  } = useClawAgentDetail(createdSlug ?? undefined);

  // Show what was actually saved, not the proposal it came from: the server
  // normalises names and expands tool sets, so leaving the proposal on screen
  // would read as unsaved edits the moment the form switches to editing. Once
  // per agent — a refetch must not overwrite what the user has typed since.
  const syncedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!createdAgent || syncedSlugRef.current === createdAgent.slug) return;
    syncedSlugRef.current = createdAgent.slug;
    setDraft(wizardStateFromAgent(createdAgent));
  }, [createdAgent]);

  const [collapseSignal, setCollapseSignal] = useState(0);
  const collapsed = useRef(false);
  useEffect(() => {
    if (collapsed.current) return;
    collapsed.current = true;
    setCollapseSignal(n => n + 1);
  }, []);

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      workspaceOpen
      collapseSignal={collapseSignal}
      workspacePanel={
        <AgentDraftBuilderPanel
          draft={draft}
          intent={seed?.intent ?? ''}
          onApplyPatch={applyAiPatch}
          onBusyChange={setAiBusy}
          onAgentCreated={setCreatedSlug}
          createdSlug={createdSlug}
          savedAgent={createdAgent}
        />
      }
    >
      <main
        data-id='ai-agent-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        {/* The agent exists — only loading it back failed. Say so and offer a
            retry, or the form sits there with no way to save and no reason. */}
        {createdSlug && createdAgentFailed && (
          <div className='mx-auto flex w-full max-w-[720px] items-center justify-between gap-3 px-6 pt-4'>
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium text-foreground'>{createdSlug}</span> was created, but
              loading it back failed, so it can&apos;t be edited here yet.
            </p>
            <button
              type='button'
              onClick={() => void refetchCreatedAgent()}
              className='shrink-0 rounded-lg border border-border px-2.5 py-1 text-sm font-medium transition-colors hover:bg-accent'
              data-track-category='Claw Agents'
              data-track-name='Create agent v2: retry loading created agent'
            >
              Retry
            </button>
          </div>
        )}
        <ClawAgentCreateV2
          draft={draft}
          onDraftChange={applyPatch}
          busy={aiBusy}
          instructionsPatchNonce={instructionsPatchNonce}
          hideSubmit={!createdAgent}
          keepSubmitVisible
          submitLabel='Update agent'
          {...(createdAgent ? { agent: createdAgent } : {})}
        />
      </main>
    </AIShell>
  );
};

export default AIAgentCreateScreen;
