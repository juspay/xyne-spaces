const CANVAS_FOLDER_UNIQUE_CONSTRAINTS = new Set([
  'canvas_folders_projectId_channelId_name_key',
  'canvas_folders_projectId_name_project_scope_key',
  'canvas_folders_createdBy_name_personal_scope_key',
]);

interface MaybeDatabaseError {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
  message?: unknown;
}

export function getCanvasFolderNameConflictMessage(
  channelId?: string | null,
  projectId?: string | null,
): string {
  if (channelId) {
    return 'A folder with this name already exists in the channel';
  }

  if (projectId) {
    return 'A folder with this name already exists in the project';
  }

  return 'A folder with this name already exists in My Canvases';
}

export function isCanvasFolderNameConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const dbError = error as MaybeDatabaseError;
  const constraint = typeof dbError.constraint === 'string' ? dbError.constraint : undefined;
  const message = typeof dbError.message === 'string' ? dbError.message : '';
  const detail = typeof dbError.detail === 'string' ? dbError.detail : '';
  const code = typeof dbError.code === 'string' ? dbError.code : undefined;

  if (constraint && CANVAS_FOLDER_UNIQUE_CONSTRAINTS.has(constraint)) {
    return true;
  }

  if (code !== '23505') {
    return false;
  }

  return (
    message.includes('canvas_folders') ||
    detail.includes('canvas_folders') ||
    Array.from(CANVAS_FOLDER_UNIQUE_CONSTRAINTS).some(name => message.includes(name))
  );
}

export function rethrowCanvasFolderNameConflict(
  error: unknown,
  channelId?: string | null,
  projectId?: string | null,
): never {
  if (isCanvasFolderNameConflictError(error)) {
    throw new Error(getCanvasFolderNameConflictMessage(channelId, projectId));
  }

  throw error;
}
