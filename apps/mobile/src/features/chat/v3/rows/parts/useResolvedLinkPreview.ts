import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { LinkPreview } from '../../model/chatRow.types';
import {
  getResolvedLinkPreview,
  loadLinkPreviewMetadata,
  subscribeToLinkPreview,
} from '../../data/linkPreviewMetadata';

export const useResolvedLinkPreview = (preview: LinkPreview): LinkPreview => {
  const subscribe = useCallback(
    (listener: () => void): (() => void) => subscribeToLinkPreview(preview.url, listener),
    [preview.url],
  );
  const getSnapshot = useCallback((): LinkPreview => getResolvedLinkPreview(preview), [preview]);
  const resolved = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (preview.needsMetadataFetch) {
      void loadLinkPreviewMetadata(preview);
    }
  }, [preview]);

  return resolved;
};
