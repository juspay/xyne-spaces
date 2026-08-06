import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import AdminV2 from '../ClawAgentsScreen/admin/AdminV2';
import { useAIChatHandoff } from './useAIChatHandoff';

const AIAdminScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      mainClassName='ai-page-bg'
    >
      <main
        data-id='ai-admin-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden border border-border bg-background'
      >
        <div className='relative flex-1 overflow-auto no-scrollbar'>
          <AdminV2 />
        </div>
      </main>
    </AIShell>
  );
};

export default AIAdminScreen;
