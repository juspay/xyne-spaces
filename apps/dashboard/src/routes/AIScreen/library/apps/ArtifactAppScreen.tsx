import { ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArtifactAppHost } from '@/components/ArtifactApp/ArtifactAppHost';
import NotFoundScreen from '@/routes/NotFoundScreen/NotFoundScreen';

/**
 * The Agent Hub's page for a saved app: the shared host with a way back to the
 * Apps tab. Bars open the same host at `/app/:appId` without the back control.
 */
const ArtifactAppScreen = (): ReactElement => {
  const { workspaceId, appId } = useParams<{ workspaceId?: string; appId?: string }>();
  const navigate = useNavigate();

  if (!appId) return <NotFoundScreen />;

  return (
    <ArtifactAppHost
      key={appId}
      appId={appId}
      placement={{ surface: 'library' }}
      showPayloadTitle
      onBack={(): void => {
        // navigate() has separate overloads for a path and a history delta,
        // so a union argument matches neither.
        if (workspaceId) void navigate(`/${workspaceId}/ai/library?tab=apps`);
        else void navigate(-1);
      }}
    />
  );
};

export default ArtifactAppScreen;
