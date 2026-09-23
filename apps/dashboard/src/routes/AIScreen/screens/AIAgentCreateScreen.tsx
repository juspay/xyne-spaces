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

export interface AgentDraftSeed {
  name?: string;
  systemPrompt?: string;
  color?: string;
}

function seededDraft(seed: AgentDraftSeed | undefined): WizardState {
  if (!seed) return INITIAL_WIZARD_STATE;
  const name = seed.name?.trim() ?? '';
  return {
    ...INITIAL_WIZARD_STATE,
    ...(name ? { name, slug: slugify(name) } : {}),
    ...(seed.systemPrompt?.trim() ? { systemPrompt: seed.systemPrompt.trim() } : {}),
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

  const initial = useRef(draft);
  const dirty = draft !== initial.current;

  const [aiBusy, setAiBusy] = useState(false);

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
          onApplyPatch={applyAiPatch}
          onBusyChange={setAiBusy}
        />
      }
    >
      <main
        data-id='ai-agent-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <ClawAgentCreateV2
          draft={draft}
          onDraftChange={applyPatch}
          busy={aiBusy}
          dirty={dirty}
          instructionsPatchNonce={instructionsPatchNonce}
        />
      </main>
    </AIShell>
  );
};

export default AIAgentCreateScreen;
