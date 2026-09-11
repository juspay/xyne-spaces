import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import ClawAgentDetailV2 from '../library/agents/detail/ClawAgentDetailV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIAgentDetailScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
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
