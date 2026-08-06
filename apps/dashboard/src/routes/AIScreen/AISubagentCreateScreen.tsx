import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import ClawSubagentCreateV2 from '../ClawAgentsScreen/library/subagents/create/ClawSubagentCreateV2';
import { useAIChatHandoff } from './useAIChatHandoff';

const AISubagentCreateScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      mainClassName='ai-page-bg'
    >
      <main
        data-id='ai-subagent-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden border border-border bg-background'
      >
        <ClawSubagentCreateV2 />
      </main>
    </AIShell>
  );
};

export default AISubagentCreateScreen;
