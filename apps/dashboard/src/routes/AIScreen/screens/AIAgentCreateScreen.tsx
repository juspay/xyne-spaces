import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { AgentCreateSplitPage } from '../library/agents/create/AgentCreateSplitPage';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIAgentCreateScreen = ({ scripted = false }: { scripted?: boolean } = {}): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id={scripted ? 'ai-agent-create-script-view' : 'ai-agent-create-view'}
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <AgentCreateSplitPage scripted={scripted} />
      </main>
    </AIShell>
  );
};

export default AIAgentCreateScreen;
