import { Channel, ChannelScopeType, User } from '@xyne/shared';
import { useMemo } from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useAllChannels } from '../../../hooks/useChannels';
import { parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';
import { apiInstance } from '../../../services/clients/apiClient';
import {
  generateDocumentThumbnail,
  isPreviewableDocument,
} from '../../../services/documentThumbnailService';
import { generateWebThumbnail, isVideoFile } from '../../../services/thumbnailService';
import { getFilesDimensions } from '../../../components/ui/utils/files';

/**
 * Hook to find an existing DM or Group DM channel that matches the selected participants
 * @param selectedUsers - Array of users selected for the conversation
 * @returns The matching channel if found, undefined otherwise
 */
export const useExistingDmChannel = (selectedUsers: User[]): Channel | undefined => {
  const { userID } = useAuthContextValues();
  const allChannels = useAllChannels();

  const dmChannels = useMemo(
    () =>
      allChannels.filter(
        channel =>
          channel.scopeType === ChannelScopeType.DM ||
          channel.scopeType === ChannelScopeType.GROUP_DM,
      ),
    [allChannels],
  );

  // Build the set of participant IDs we're looking for (selected users + current user)
  const targetParticipantIds = useMemo(() => {
    const ids = new Set<string>(selectedUsers.map(u => u.id));
    ids.add(userID);
    return ids;
  }, [selectedUsers, userID]);

  const matchingChannel = useMemo(() => {
    if (selectedUsers.length === 0) return undefined;

    return dmChannels.find(channel => {
      // Parse participant IDs from the channel name
      const participantIds = parseDMParticipantIds({
        name: channel.name,
        scopeType: channel.scopeType,
      });

      if (participantIds.length !== targetParticipantIds.size) {
        return false;
      }

      // Check if all participant IDs match the target set
      for (const id of participantIds) {
        if (!targetParticipantIds.has(id)) {
          return false;
        }
      }

      return true;
    });
  }, [dmChannels, selectedUsers.length, targetParticipantIds]);

  return matchingChannel;
};

// Helper to send conversation with attachments via API
export const sendConversationWithAttachments = async (
  channelId: string,
  content: string,
  files: File[],
): Promise<void> => {
  const formData = new FormData();

  // Add content
  formData.append('content', content);

  if (files.length > 0) {
    const thumbnails = await generateThumbnails(files);
    const dimensionsMap = await getFilesDimensions(files);

    const fileMetadata: Array<{
      fileIndex: number;
      hasThumbnail: boolean;
      thumbnailIndex?: number;
      width?: number;
      height?: number;
      duration?: number;
    }> = [];

    let thumbnailIndex = 0;

    files.forEach((file, fileIndex) => {
      formData.append('files', file);

      const thumbnail = thumbnails[fileIndex];
      const dimensions = dimensionsMap.get(file) ?? undefined;

      if (thumbnail) {
        formData.append('thumbnails', thumbnail, `thumb_${thumbnailIndex}.jpg`);

        fileMetadata.push({
          fileIndex,
          hasThumbnail: true,
          thumbnailIndex,
          ...(dimensions && {
            width: dimensions.width,
            height: dimensions.height,
          }),
          ...(dimensions?.duration && { duration: dimensions.duration }),
        });

        thumbnailIndex++;
      } else {
        fileMetadata.push({
          fileIndex,
          hasThumbnail: false,
          ...(dimensions && {
            width: dimensions.width,
            height: dimensions.height,
          }),
          ...(dimensions?.duration && { duration: dimensions.duration }),
        });
      }
    });

    formData.append('fileMetadata', JSON.stringify(fileMetadata));
  }

  // Call conversation API with multipart/form-data
  await apiInstance.post(`/channels/${channelId}/conversations`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

const generateThumbnails = async (files: File[]): Promise<Array<Blob | undefined>> => {
  const results = await Promise.all(
    files.map(async file => {
      if (isVideoFile(file)) {
        try {
          return (await generateWebThumbnail(file)).blob;
        } catch {
          return undefined;
        }
      }

      if (isPreviewableDocument(file.type)) {
        try {
          return await generateDocumentThumbnail(file);
        } catch {
          return undefined;
        }
      }

      return undefined;
    }),
  );

  return results.map(thumbnail => thumbnail ?? undefined);
};
