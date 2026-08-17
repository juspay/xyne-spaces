import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import LibraryV2 from '../library/LibraryV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AILibraryScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-library-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <div className='relative flex-1 overflow-auto no-scrollbar'>
          <LibraryV2 />
        </div>
      </main>
    </AIShell>
  );
};

export default AILibraryScreen;
