import { CanvasRole } from '@xyne/shared';

/** Repository-channel members receive read-only access to every new SDLC canvas. */
export const SDLC_CHANNEL_CANVAS_ROLE = CanvasRole.VIEWER;

export const sdlcCanvasParticipants = (
  workspaceId: string,
  channelId: string | null,
  creatorUserId: string,
  connectId?: string | null,
  channelConnectId?: string | null,
) => {
  if (!channelId) throw new Error('SDLC canvas requires a repository channel');
  // Slack Connect: inherit the parent canvas's connectId when known.
  const connect = connectId ? { canvasConnectId: connectId } : {};
  // Slack Connect: only the channel row carries the channel's handle (the creator's user row has no
  // channel). Callers create these rows NESTED inside `canvas.create`, which connectStamp never sees
  // (it only stamps top-level writes), so it is passed explicitly rather than stamped.
  const channelConnect = channelConnectId ? { channelConnectId } : {};
  return [
    { workspaceId, channelId, role: SDLC_CHANNEL_CANVAS_ROLE, ...connect, ...channelConnect },
    { workspaceId, userId: creatorUserId, role: CanvasRole.OWNER, ...connect },
  ];
};
