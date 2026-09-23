import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { ArtifactAppHost, type ArtifactAppPlacement } from './ArtifactAppHost';
import NotFoundScreen from '../../routes/NotFoundScreen/NotFoundScreen';

interface ArtifactAppHostRouteProps {
  /** Which bar sent the user here — the app is told, and may lay itself out
   *  differently for the full-screen rail and the narrower Inbox panel. */
  placement: ArtifactAppPlacement;
}

/**
 * `/:workspaceId/app/:appId` (full screen) and `/:workspaceId/chat/dir/app/:appId`
 * (inside the chat panel) both mount this: the route decides the box, the host
 * fills it. Keyed on the app so switching between two bar apps remounts the
 * sandbox rather than reusing one app's iframe for another's payload.
 */
export const ArtifactAppHostRoute = ({ placement }: ArtifactAppHostRouteProps): ReactElement => {
  const { appId } = useParams<{ appId?: string }>();
  if (!appId) return <NotFoundScreen />;
  return <ArtifactAppHost key={appId} appId={appId} placement={placement} />;
};
