export type CanvasDestinationAccessErrorCode =
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_ARCHIVED'
  | 'CHANNEL_MEMBERSHIP_REQUIRED'
  | 'PROJECT_MEMBERSHIP_REQUIRED';

export class CanvasDestinationAccessError extends Error {
  constructor(
    public readonly code: CanvasDestinationAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasDestinationAccessError';
  }
}

interface CanvasDestinationChannelRecord {
  projectId: string;
  isArchived?: boolean | null;
}

type MaybeRecord<T> = T | null | undefined;

interface AssertCanvasDestinationAccessParams {
  projectId?: string | null;
  channelId?: string | null;
  loadChannel: (channelId: string) => Promise<MaybeRecord<CanvasDestinationChannelRecord>>;
  isChannelMember: (channelId: string) => Promise<boolean>;
  isProjectMember: (projectId: string) => Promise<boolean>;
}

/**
 * Verifies the current user is allowed to place a canvas in the resolved
 * destination location.
 *
 * This is intentionally separate from hierarchy validation: callers should
 * first resolve folder/channel/project consistency, then verify that the
 * user can actually use the resulting destination context.
 */
export async function assertCanvasDestinationAccess(
  params: AssertCanvasDestinationAccessParams,
): Promise<void> {
  if (params.channelId != null) {
    const channel = await params.loadChannel(params.channelId);
    if (!channel) {
      throw new CanvasDestinationAccessError(
        'CHANNEL_NOT_FOUND',
        'Canvas move failed: destination channel not found',
      );
    }

    if (channel.isArchived) {
      throw new CanvasDestinationAccessError(
        'CHANNEL_ARCHIVED',
        'Canvas move failed: cannot move canvases into an archived channel',
      );
    }

    const isChannelMember = await params.isChannelMember(params.channelId);
    if (!isChannelMember) {
      throw new CanvasDestinationAccessError(
        'CHANNEL_MEMBERSHIP_REQUIRED',
        'Canvas move failed: you must be a member of the destination channel',
      );
    }

    return;
  }

  if (params.projectId != null) {
    const isProjectMember = await params.isProjectMember(params.projectId);
    if (!isProjectMember) {
      throw new CanvasDestinationAccessError(
        'PROJECT_MEMBERSHIP_REQUIRED',
        'Canvas move failed: you must be a member of a destination project channel',
      );
    }
  }
}
