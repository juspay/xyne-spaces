import { type ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { AIShell } from '../../components/AIScreen/AIShell';
import { useAIChatHandoff } from './useAIChatHandoff';

const AISectionLayout = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <div className='relative min-h-0 flex-1 overflow-auto no-scrollbar'>
        <Outlet />
      </div>
    </AIShell>
  );
};

export default AISectionLayout;
