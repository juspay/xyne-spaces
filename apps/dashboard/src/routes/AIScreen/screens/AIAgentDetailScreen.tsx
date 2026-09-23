import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { useClawAgentDetail } from '../../../hooks/useClawAgentDetail';
import ClawAgentDetailV2 from '../library/agents/detail/ClawAgentDetailV2';
import { AgentBuilderPanel } from '../library/agents/detail/AgentBuilderPanel';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIAgentDetailScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();
  const { slug } = useParams<{ slug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const building = searchParams.get('build') === '1';
  const { data: agent } = useClawAgentDetail(slug);
  const open = building && agent !== undefined;

  const closeBuilder = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('build');
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const [collapseSignal, setCollapseSignal] = useState(0);
  const collapsedForThisOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      collapsedForThisOpen.current = false;
      return;
    }
    if (collapsedForThisOpen.current) return;
    collapsedForThisOpen.current = true;
    setCollapseSignal(n => n + 1);
  }, [open]);

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      workspaceOpen={open}
      onCloseWorkspace={closeBuilder}
      collapseSignal={collapseSignal}
      {...(open && agent
        ? { workspacePanel: <AgentBuilderPanel agent={agent} onClose={closeBuilder} /> }
        : {})}
    >
      <main
        data-id='ai-agent-detail-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <ClawAgentDetailV2 />
      </main>
    </AIShell>
  );
};

export default AIAgentDetailScreen;
