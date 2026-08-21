import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import DigitalTwinV2 from '../digitalTwin/DigitalTwinV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIDigitalTwinScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-digital-twin-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <div className='h-[32px] w-full shrink-0' />
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          <DigitalTwinV2 />
        </div>
      </main>
    </AIShell>
  );
};

export default AIDigitalTwinScreen;
