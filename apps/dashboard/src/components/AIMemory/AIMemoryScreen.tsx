import { type ReactElement } from 'react';
import { AIShell } from '../AIScreen/AIShell';
import { useAIChatHandoff } from '../../routes/AIScreen/useAIChatHandoff';
import { MemoryFolderBrowser } from './MemoryFolderBrowser';

const AIMemoryScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      mainClassName='ai-page-bg h-full min-h-0 overflow-hidden'
    >
      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
        <MemoryFolderBrowser />
      </div>
    </AIShell>
  );
};

export default AIMemoryScreen;
