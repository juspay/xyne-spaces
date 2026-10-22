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
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { wizardStateFromAgent } from '../library/agents/create/agentDraft';

const AUTOSAVE_DELAY_MS = 1200;

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

  const saveRef = useRef<((options?: { quiet?: boolean }) => Promise<void>) | null>(null);
  const createdRef = useRef(false);

  const [editTick, setEditTick] = useState(0);
  const applyPatch = useCallback((patch: Partial<WizardState>) => {
    setDraft(prev => ({ ...prev, ...patch }));
    setEditTick(tick => tick + 1);
  }, []);

  const autosaveTick = useDebouncedValue(editTick, AUTOSAVE_DELAY_MS);
  useEffect(() => {
    if (autosaveTick === 0 || !createdRef.current) return;
    void saveRef.current?.({ quiet: true }).catch(() => {});
  }, [autosaveTick]);

  const [instructionsPatchNonce, setInstructionsPatchNonce] = useState(0);

  const [aiBusy, setAiBusy] = useState(false);

  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const {
    data: createdAgent,
    isError: createdAgentFailed,
    refetch: refetchCreatedAgent,
  } = useClawAgentDetail(createdSlug ?? undefined);

  const syncedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!createdAgent || syncedSlugRef.current === createdAgent.slug) return;
    syncedSlugRef.current = createdAgent.slug;
    setDraft(wizardStateFromAgent(createdAgent));
  }, [createdAgent]);

  const registerSave = useCallback(
    (save: ((options?: { quiet?: boolean }) => Promise<void>) | null) => {
      saveRef.current = save;
    },
    [],
  );
  const requestSave = useCallback(async (): Promise<void> => {
    if (!saveRef.current) throw new Error('The setup form is not ready yet.');
    await saveRef.current();
  }, []);

  createdRef.current = createdSlug !== null;
  const applyAiPatch = useCallback((patch: Partial<WizardState>) => {
    setDraft(prev => ({ ...prev, ...patch }));
    if (patch.systemPrompt !== undefined && !createdRef.current) {
      setInstructionsPatchNonce(n => n + 1);
    }
  }, []);

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
          onRequestSave={requestSave}
        />
      }
    >
      <main
        data-id='ai-agent-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
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
          hideSubmit
          registerSave={registerSave}
          {...(createdAgent ? { agent: createdAgent } : {})}
        />
      </main>
    </AIShell>
  );
};

export default AIAgentCreateScreen;
