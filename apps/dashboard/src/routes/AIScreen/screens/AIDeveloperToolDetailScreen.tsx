import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import DeveloperToolDetailV2 from '../library/developers/detail/DeveloperToolDetailV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIDeveloperToolDetailScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-developer-tool-detail-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <DeveloperToolDetailV2 />
      </main>
    </AIShell>
  );
};

export default AIDeveloperToolDetailScreen;
