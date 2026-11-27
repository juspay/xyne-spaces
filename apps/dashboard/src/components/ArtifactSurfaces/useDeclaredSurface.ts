import { useEffect } from 'react';
import { toast } from 'sonner';
import { canOpenOn } from '../ArtifactApp/appSurfaces';
import type { ReactArtifactRef } from '../AIScreen/ReactArtifact/ReactArtifact.types';
import { removeWidget, turnOffOverlayFor } from './surfacesStore';

/**
 * Whether the app's served build declares this surface. One that does not is
 * switched off with a message — it may have been chosen before its author
 * changed what it is, or saved here by hand. Not a failure: retrying would not
 * help, so it never counts toward the failure limit.
 *
 * True until the build is known, so nothing is switched off on a guess.
 */
export const useDeclaredSurface = (
  appId: string,
  surface: 'overlay' | 'widget',
  artifact: ReactArtifactRef | null,
  title: string,
): boolean => {
  const allowed = !artifact || canOpenOn(artifact.manifest, surface);

  useEffect(() => {
    if (allowed) return;
    if (surface === 'overlay') turnOffOverlayFor(appId);
    else removeWidget(appId);
    toast.error(`${title} isn't ${surface === 'overlay' ? 'an overlay' : 'a widget'} app`, {
      description: 'Its author built it for somewhere else. It still opens in the Agent Hub.',
    });
    // Once per transition into "not allowed"; the title is for the message only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, appId, surface]);

  return allowed;
};
