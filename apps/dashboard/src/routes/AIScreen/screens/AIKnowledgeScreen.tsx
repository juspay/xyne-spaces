import { type ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { KbContentsShell } from '../../../components/knowledgeBaseV2/KbContentsShell';
import { useAIChatHandoff } from '../useAIChatHandoff';

// Layout for the /ai/knowledge subtree — wraps both the folder browser
// (index route) and the file viewer (nested route, same as /knowledge-base's
// own file-viewer path) so opening a file from here stays under /ai/knowledge
// instead of hopping to the standalone KB screen.
const AIKnowledgeScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      mainClassName='ai-page-bg'
    >
      <KbContentsShell>
        <Outlet />
      </KbContentsShell>
    </AIShell>
  );
};

export default AIKnowledgeScreen;
