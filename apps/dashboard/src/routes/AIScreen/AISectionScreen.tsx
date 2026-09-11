import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import { AIComingSoon } from '../../components/AIScreen/AIComingSoon';
import { useAIChatHandoff } from './useAIChatHandoff';

const AISectionScreen = ({ title }: { title: string }): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <AIComingSoon title={title} />
    </AIShell>
  );
};

export default AISectionScreen;
