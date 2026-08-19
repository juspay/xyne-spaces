import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import ClawSkillDetailV2 from '../library/skills/detail/ClawSkillDetailV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AISkillDetailScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-skill-detail-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <ClawSkillDetailV2 />
      </main>
    </AIShell>
  );
};

export default AISkillDetailScreen;
