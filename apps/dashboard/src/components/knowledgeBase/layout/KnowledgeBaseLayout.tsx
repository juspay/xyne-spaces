import React from 'react';
import { Outlet } from 'react-router-dom';
import { CollectionTreeDataSync } from '../hooks/CollectionTreeDataSync';

export const KnowledgeBaseLayout: React.FC = () => {
  return (
    <CollectionTreeDataSync>
      <Outlet />
    </CollectionTreeDataSync>
  );
};
