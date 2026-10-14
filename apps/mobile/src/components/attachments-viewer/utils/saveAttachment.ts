import { Alert, Platform, Share, ToastAndroid } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

import { isMediaFile } from '@/src/components/chat/message/message-attachments.utils';
import { haptics } from '@/src/utils/haptics';
import {
  resolveAttachmentMimeType,
  sanitizeCacheFileName,
} from '@/src/components/attachments-viewer/utils/file-viewer';
import { saveFileToDownloadsNative } from '@/src/modules/downloads/NativeDownloadsModule';

const IOS_MEDIA_EXTENSIONS = new Map<string, readonly string[]>([
  ['image/jpeg', ['jpg', 'jpeg']],
  ['image/jpg', ['jpg', 'jpeg']],
  ['image/png', ['png']],
  ['image/gif', ['gif']],
  ['image/webp', ['webp']],
  ['image/heic', ['heic']],
  ['image/heif', ['heif']],
  ['video/mp4', ['mp4', 'm4v']],
  ['video/quicktime', ['mov']],
  ['video/webm', ['webm']],
]);

const assertLocalFileReady = async (localUri: string): Promise<void> => {
  const fileInfo = await FileSystem.getInfoAsync(localUri);
  if (!fileInfo.exists) {
    throw new Error('File is not ready to save yet. Please try again in a moment.');
  }
};

const getUriExtension = (localUri: string): string => {
  const lastSegment = localUri.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  return dotIndex > 0 ? lastSegment.slice(dotIndex + 1).toLowerCase() : '';
};

const replaceUriExtension = (localUri: string, extension: string): string => {
  const slashIndex = localUri.lastIndexOf('/');
  const dotIndex = localUri.lastIndexOf('.');
  const stem = dotIndex > slashIndex ? localUri.slice(0, dotIndex) : localUri;
  return `${stem}.${extension}`;
};

/**
 * iOS determines the asset type from the local filename as well as the bytes.
 * Cached previews can have no extension or a generic `.jpg` extension even when
 * the attachment is PNG/WebP/HEIC, so give MediaLibrary a matching local path.
 */
const ensureIosMediaExtension = async (localUri: string, mimetype: string): Promise<string> => {
  const validExtensions = IOS_MEDIA_EXTENSIONS.get(mimetype.toLowerCase());
  if (!validExtensions) return localUri;

  const currentExtension = getUriExtension(localUri);
  if (validExtensions.includes(currentExtension)) return localUri;

  const preferredExtension = validExtensions[0];
  if (!preferredExtension) return localUri;

  const compatibleUri = replaceUriExtension(localUri, preferredExtension);
  const compatibleFileInfo = await FileSystem.getInfoAsync(compatibleUri);
  if (!compatibleFileInfo.exists) {
    await FileSystem.copyAsync({ from: localUri, to: compatibleUri });
  }
  return compatibleUri;
};

const saveToAndroidDownloads = async (
  localUri: string,
  filename: string,
  mimetype: string,
): Promise<void> => {
  await assertLocalFileReady(localUri);
  await saveFileToDownloadsNative(
    localUri,
    sanitizeCacheFileName(filename),
    mimetype || 'application/octet-stream',
  );
  void haptics.success();
  ToastAndroid.show('Saved to Downloads.', ToastAndroid.SHORT);
};

export const saveToIosPhotoLibrary = async (localUri: string, mimetype: string): Promise<void> => {
  await assertLocalFileReady(localUri);

  // This operation only adds an asset. Do not request read access to the user's library.
  const { status } = await MediaLibrary.requestPermissionsAsync(true);
  if (status !== 'granted') {
    throw new Error('Please allow access to your photo library to save media.');
  }

  const compatibleUri = await ensureIosMediaExtension(localUri, mimetype);
  try {
    await MediaLibrary.Asset.create(compatibleUri);
  } catch (error) {
    console.error(
      '[saveAttachment] iOS media save failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    throw new Error('Could not save media to your photo library. Please try again.');
  }

  void haptics.success();
  Alert.alert('Saved', 'Saved to your photo library.');
};

/**
 * @param localUri  A local `file://` uri of the already-downloaded attachment.
 * @param filename  Display name (with extension) for the saved file.
 * @param mimetype  Best-known mime type; used for the Android save + share UTI.
 */
export const shareOrSaveAttachment = async (
  localUri: string,
  filename: string,
  mimetype: string,
): Promise<void> => {
  const resolvedMime = resolveAttachmentMimeType(mimetype, filename);

  if (Platform.OS === 'android') {
    await saveToAndroidDownloads(localUri, filename, resolvedMime);
    return;
  }

  if (isMediaFile(resolvedMime)) {
    await saveToIosPhotoLibrary(localUri, resolvedMime);
    return;
  }

  await assertLocalFileReady(localUri);
  await Share.share({ url: localUri });
};
