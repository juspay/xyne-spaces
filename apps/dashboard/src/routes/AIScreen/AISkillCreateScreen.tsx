import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import ClawSkillCreateV2 from '../ClawAgentsScreen/skill-create-v2/ClawSkillCreateV2';
import { useAIChatHandoff } from './useAIChatHandoff';

const AISkillCreateScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      mainClassName='ai-page-bg'
    >
      <main
        data-id='ai-skill-create-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden border border-border bg-background'
      >
        <ClawSkillCreateV2 />
      </main>
    </AIShell>
  );
};

export default AISkillCreateScreen;
