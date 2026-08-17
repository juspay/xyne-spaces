import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import ClawSubagentCreateV2 from '../library/subagents/create/ClawSubagentCreateV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AISubagentCreateScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-subagent-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <ClawSubagentCreateV2 />
      </main>
    </AIShell>
  );
};

export default AISubagentCreateScreen;
