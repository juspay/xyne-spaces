import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import ClawAgentCreateV2 from '../library/agents/create/ClawAgentCreateV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIAgentCreateScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-agent-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <ClawAgentCreateV2 />
      </main>
    </AIShell>
  );
};

export default AIAgentCreateScreen;
