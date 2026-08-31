import React from 'react';
import { Outlet } from 'react-router-dom';
import { KbContentsShell } from './KbContentsShell';

// Wraps both the folder/collection browser (KnowledgeBaseV2Screen) and the
// file viewer (FileViewerLayout) — both are children of this layout's
// <Outlet/>, and both already keep `activeCollection`/`currentFolderId` in
// the shared knowledgeBaseMachine in sync with their own URLs. The actual
// Contents panel lives in KbContentsShell, shared with the /ai/knowledge
// embedding (AIKnowledgeScreen) so both keep the exact same panel, data
// fetching, and navigation behavior instead of two copies drifting apart.
export const KnowledgeBaseV2Layout: React.FC = () => {
  return (
    <KbContentsShell>
      <Outlet />
    </KbContentsShell>
  );
};
