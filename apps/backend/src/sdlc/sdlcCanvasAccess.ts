import { CanvasRole } from '@xyne/shared';

/** Repository-channel members receive read-only access to every new SDLC canvas. */
export const SDLC_CHANNEL_CANVAS_ROLE = CanvasRole.VIEWER;

export const sdlcCanvasParticipants = (
  workspaceId: string,
  channelId: string | null,
  creatorUserId: string,
  connectId?: string | null,
) => {
  if (!channelId) throw new Error('SDLC canvas requires a repository channel');
  // Slack Connect: inherit the parent canvas's connectId when known.
  const connect = connectId ? { canvasConnectId: connectId } : {};
  return [
    { workspaceId, channelId, role: SDLC_CHANNEL_CANVAS_ROLE, ...connect },
    { workspaceId, userId: creatorUserId, role: CanvasRole.OWNER, ...connect },
  ];
};
