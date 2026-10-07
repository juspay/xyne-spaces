import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { AgentCreateSplitPage } from '../library/agents/create/AgentCreateSplitPage';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIAgentCreateScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-agent-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <AgentCreateSplitPage />
      </main>
    </AIShell>
  );
};

export default AIAgentCreateScreen;
