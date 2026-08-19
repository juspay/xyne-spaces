import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import AdminV2 from '../library/admin/AdminV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIAdminScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-admin-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <div className='h-[32px] w-full shrink-0' />
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          <AdminV2 />
        </div>
      </main>
    </AIShell>
  );
};

export default AIAdminScreen;
