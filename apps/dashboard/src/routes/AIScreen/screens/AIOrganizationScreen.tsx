import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import OrganizationV2 from '../organization/OrganizationV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIOrganizationScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-organization-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <div className='h-[32px] w-full shrink-0' />
        <div className='relative min-h-0 flex-1 overflow-auto no-scrollbar'>
          <OrganizationV2 />
        </div>
      </main>
    </AIShell>
  );
};

export default AIOrganizationScreen;
