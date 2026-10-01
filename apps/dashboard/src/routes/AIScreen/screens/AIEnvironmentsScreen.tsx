import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { EnvironmentsView } from '../environments/EnvironmentsView';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIEnvironmentsScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main className='relative flex h-full flex-1 flex-col overflow-hidden'>
        <EnvironmentsView />
      </main>
    </AIShell>
  );
};

export default AIEnvironmentsScreen;
