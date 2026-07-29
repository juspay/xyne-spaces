import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import KnowledgeBaseV2Screen from '../../components/knowledgeBaseV2/KnowledgeBaseV2Screen';
import { GlobalCollectionsProvider } from '../../components/knowledgeBaseV2/hooks/useGlobalCollections';
import { CollectionTreeDataSync } from '../../components/knowledgeBase/hooks/CollectionTreeDataSync';
import { useAIChatHandoff } from './useAIChatHandoff';

const AIKnowledgeScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell
      onCreateChat={onCreateChat}
      onSelectSession={onSelectSession}
      mainClassName='ai-page-bg'
    >
      <GlobalCollectionsProvider>
        <CollectionTreeDataSync>
          <KnowledgeBaseV2Screen />
        </CollectionTreeDataSync>
      </GlobalCollectionsProvider>
    </AIShell>
  );
};

export default AIKnowledgeScreen;
