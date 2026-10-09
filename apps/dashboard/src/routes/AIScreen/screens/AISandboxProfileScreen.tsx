import { type ReactElement } from 'react';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { SandboxProfileFormPage } from '../environments/SandboxProfileForm';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AISandboxProfileScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-sandbox-profile-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        <SandboxProfileFormPage />
      </main>
    </AIShell>
  );
};

export default AISandboxProfileScreen;
