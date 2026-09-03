import { CanvasRole } from '@xyne/shared';

/** Repository-channel members receive read-only access to new SDLC canvases by default (baselines, wiki pages). */
export const SDLC_CHANNEL_CANVAS_ROLE = CanvasRole.VIEWER;

/** PRD / Tech Doc artifacts are collaborative: every repository-channel member can edit them by default. */
export const SDLC_ARTIFACT_CANVAS_ROLE = CanvasRole.EDITOR;

export const sdlcChannelCanvasParticipant = (
  workspaceId: string,
  channelId: string | null,
  role: CanvasRole = SDLC_CHANNEL_CANVAS_ROLE
) => {
  if (!channelId) throw new Error('SDLC canvas requires a repository channel');
  return {
    workspaceId,
    channelId,
    role,
  };
};
