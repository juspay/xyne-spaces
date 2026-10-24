import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import { DesignSystemsScreen } from '../../components/AIScreen/DesignSystems/DesignSystemsScreen';
import { useAIChatHandoff } from './useAIChatHandoff';

const AIDesignSystemsScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-design-systems-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <div className='h-[32px] w-full shrink-0' />
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          <DesignSystemsScreen />
        </div>
      </main>
    </AIShell>
  );
};

export default AIDesignSystemsScreen;
