export type CanvasHierarchyErrorCode =
  | 'FOLDER_NOT_FOUND'
  | 'FOLDER_PROJECT_MISMATCH'
  | 'FOLDER_CHANNEL_MISMATCH'
  | 'PROJECT_FOLDER_IN_CHANNEL'
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_PROJECT_MISMATCH';

export class CanvasHierarchyResolutionError extends Error {
  constructor(
    public readonly code: CanvasHierarchyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasHierarchyResolutionError';
  }
}

interface CanvasHierarchyFolderRecord {
  projectId: string | null;
  channelId: string | null;
}

interface CanvasHierarchyChannelRecord {
  projectId?: string | null;
}

type MaybeRecord<T> = T | null | undefined;

interface ResolveCanvasHierarchyParams {
  folderId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
  loadFolder: (folderId: string) => Promise<MaybeRecord<CanvasHierarchyFolderRecord>>;
  loadChannel: (channelId: string) => Promise<MaybeRecord<CanvasHierarchyChannelRecord>>;
}

export interface ResolvedCanvasHierarchy {
  folderId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
}

export async function resolveCanvasHierarchy(
  params: ResolveCanvasHierarchyParams,
): Promise<ResolvedCanvasHierarchy> {
  let resolvedProjectId = params.projectId;
  let resolvedChannelId = params.channelId;

  if (params.folderId) {
    const folder = await params.loadFolder(params.folderId);
    if (!folder) {
      throw new CanvasHierarchyResolutionError('FOLDER_NOT_FOUND', 'Canvas folder not found');
    }

    if (resolvedProjectId != null && resolvedProjectId !== folder.projectId) {
      throw new CanvasHierarchyResolutionError(
        'FOLDER_PROJECT_MISMATCH',
        'Canvas folder does not belong to project',
      );
    }

    if (resolvedChannelId != null && resolvedChannelId !== folder.channelId) {
      throw new CanvasHierarchyResolutionError(
        folder.channelId ? 'FOLDER_CHANNEL_MISMATCH' : 'PROJECT_FOLDER_IN_CHANNEL',
        folder.channelId
          ? 'Canvas folder does not belong to channel'
          : 'Folder without a channel cannot be used inside a channel',
      );
    }

    resolvedProjectId = folder.projectId;
    resolvedChannelId = folder.channelId ?? resolvedChannelId;
  }

  if (resolvedChannelId != null) {
    const channel = await params.loadChannel(resolvedChannelId);
    if (!channel) {
      throw new CanvasHierarchyResolutionError('CHANNEL_NOT_FOUND', 'Channel not found');
    }

    if (resolvedProjectId != null && channel.projectId != null && resolvedProjectId !== channel.projectId) {
      throw new CanvasHierarchyResolutionError(
        'CHANNEL_PROJECT_MISMATCH',
        'Canvas channel does not belong to project',
      );
    }
  }

  return {
    folderId: params.folderId,
    projectId: resolvedProjectId,
    channelId: resolvedChannelId,
  };
}
