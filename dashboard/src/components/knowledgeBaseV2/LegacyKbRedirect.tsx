import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

// Maps the legacy nested-path knowledge-base URLs onto the new
// search-params layout. Without this, browser-history entries created
// before the route change would 404 when the user navigates back.
//
//   /knowledge-base/:projectId
//   /knowledge-base/:projectId/:channelId
//   /knowledge-base/:projectId/:channelId/:collectionId
//   /knowledge-base/:projectId/:channelId/:collectionId/:folderId
//
// The screen itself only needs ?cl=&parent= — projectId / channelId are
// resolvable from the collection record.
export const LegacyKbRedirect: React.FC = () => {
  const { collectionId, folderId } = useParams<{
    projectId?: string;
    channelId?: string;
    collectionId?: string;
    folderId?: string;
  }>();

  const sp = new URLSearchParams();
  if (collectionId) sp.set('cl', collectionId);
  if (folderId && folderId !== '_') sp.set('parent', folderId);
  const qs = sp.toString();
  return <Navigate to={qs ? `../?${qs}` : '..'} replace />;
};
