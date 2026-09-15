import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import ClawSubagentDetailV2 from '../library/subagents/detail/ClawSubagentDetailV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AISubagentDetailScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-subagent-detail-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <ClawSubagentDetailV2 />
      </main>
    </AIShell>
  );
};

export default AISubagentDetailScreen;
