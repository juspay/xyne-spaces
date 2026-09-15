import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import ClawMcpDetailV2 from '../library/mcp/detail/ClawMcpDetailV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIMcpDetailScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-mcp-detail-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <ClawMcpDetailV2 />
      </main>
    </AIShell>
  );
};

export default AIMcpDetailScreen;
