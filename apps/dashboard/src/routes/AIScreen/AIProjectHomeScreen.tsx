import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import { ProjectHome } from '../../components/AIScreen/ProjectHome/ProjectHome';
import { useAIChatHandoff } from './useAIChatHandoff';

const AIProjectHomeScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <ProjectHome />
    </AIShell>
  );
};

export default AIProjectHomeScreen;
