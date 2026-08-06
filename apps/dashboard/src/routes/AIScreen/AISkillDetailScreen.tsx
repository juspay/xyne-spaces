import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import ClawSkillDetailV2 from '../ClawAgentsScreen/library/skills/detail/ClawSkillDetailV2';
import { useAIChatHandoff } from './useAIChatHandoff';

const AISkillDetailScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      mainClassName='ai-page-bg'
    >
      <main
        data-id='ai-skill-detail-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden border border-border bg-background'
      >
        <ClawSkillDetailV2 />
      </main>
    </AIShell>
  );
};

export default AISkillDetailScreen;
