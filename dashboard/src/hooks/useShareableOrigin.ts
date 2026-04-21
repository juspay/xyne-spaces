import { useParams } from 'react-router-dom';

/**
 * Returns the base URL to use when constructing shareable/copyable links.
 * Automatically includes the current workspace segment when inside `/:workspaceId` context.
 *
 * Usage:
 *   const shareableOrigin = useShareableOrigin();
 *   const link = `${shareableOrigin}/chat/dir/${channelId}`;
 */
export function useShareableOrigin(): string {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  return workspaceId ? `${window.location.origin}/${workspaceId}` : window.location.origin;
}
