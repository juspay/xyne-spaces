import React from 'react';
import { Outlet } from 'react-router-dom';
import { CollectionTreeDataSync } from '../../components/knowledgeBase/hooks/CollectionTreeDataSync';
import { GlobalCollectionsProvider } from './hooks/useGlobalCollections';

export const KnowledgeBaseV2Layout: React.FC = () => {
  return (
    <GlobalCollectionsProvider>
      <CollectionTreeDataSync>
        <Outlet />
      </CollectionTreeDataSync>
    </GlobalCollectionsProvider>
  );
};
