import { CanvasRole } from '@xyne/shared';

/** Repository-channel members receive read-only access to every new SDLC canvas. */
export const SDLC_CHANNEL_CANVAS_ROLE = CanvasRole.VIEWER;

export const sdlcChannelCanvasParticipant = (workspaceId: string, channelId: string | null) => {
  if (!channelId) throw new Error('SDLC canvas requires a repository channel');
  return {
    workspaceId,
    channelId,
    role: SDLC_CHANNEL_CANVAS_ROLE,
  };
};
