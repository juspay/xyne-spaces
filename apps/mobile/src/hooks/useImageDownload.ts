/**
 * useImageDownload Hook
 *
 * Saves a locally-cached image (from useMtlsImage) to the device.
 * Android: Downloads folder. iOS: photo library.
 */

import { useState, useCallback } from 'react';
import { File, Paths } from 'expo-file-system';
import { Alert } from 'react-native';

import { shareOrSaveAttachment } from '@/src/components/attachments-viewer/utils/saveAttachment';
import { resolveAttachmentMimeType } from '@/src/components/attachments-viewer/utils/file-viewer';
import { usePersistentAttachmentDownload } from '@/src/hooks/usePersistentAttachmentDownload';
import { isVideoFile } from '@/src/components/chat/message/message-attachments.utils';

interface UseMediaDownloadOptions {
  filename?: string;
  mimetype?: string;
}

interface UseMediaDownloadResult {
  download: (attachmentId: string, options?: UseMediaDownloadOptions) => Promise<void>;
  isDownloading: boolean;
}

export function useImageDownload(): UseMediaDownloadResult {
  const [isDownloading, setIsDownloading] = useState(false);
  const { download: startPersistentDownload, isStarting: isPersistentStarting } =
    usePersistentAttachmentDownload();

  const download = useCallback(
    async (attachmentId: string, options?: UseMediaDownloadOptions) => {
      if (isDownloading || isPersistentStarting) return;

      const filename = options?.filename?.trim() || `${attachmentId}.jpg`;
      const mimetype = options?.mimetype?.trim() || 'image/jpeg';
      const resolvedMime = resolveAttachmentMimeType(mimetype, filename);

      if (isVideoFile(resolvedMime)) {
        await startPersistentDownload(attachmentId, filename, resolvedMime);
        return;
      }

      setIsDownloading(true);
      try {
        const file = new File(Paths.cache, 'images', `${attachmentId}.jpg`);
        if (!file.exists) {
          Alert.alert('Not ready', 'Image is still loading. Please try again in a moment.');
          return;
        }

        await shareOrSaveAttachment(file.uri, filename, resolvedMime);
      } catch (error) {
        console.error('[useImageDownload] Error saving media:', error);
        const message =
          error instanceof Error ? error.message : 'Failed to save file. Please try again.';
        Alert.alert('Error', message);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, isPersistentStarting, startPersistentDownload],
  );

  return { download, isDownloading: isDownloading || isPersistentStarting };
}
