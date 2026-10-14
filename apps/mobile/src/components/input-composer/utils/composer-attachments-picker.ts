import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { v4 as uuidv4 } from 'uuid';

import { resolveAttachmentImageDimensions } from '@/src/utils/getImageDimensions';

import type { ComposerAttachment } from '../input-composer.types';
import {
  assertAttachmentCountWithinLimit,
  getAttachmentRejectionReason,
  MAX_COMPOSER_ATTACHMENT_COUNT,
} from './attachmentPolicy';

const ALL_FILE_TYPES = '*/*';
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

export type AttachmentPicker = (
  allowedFileTypes: string[],
  remainingSlots?: number,
) => Promise<ComposerAttachment[]>;

const mimeAllowed = (mime: string, allowed: string[]): boolean => {
  if (!allowed.length) return true;
  if (allowed.includes(ALL_FILE_TYPES)) return true;
  return allowed.some(rule => {
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1));
    return rule === mime;
  });
};

const getFileExtension = (filename: string): string => {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex === -1 ? '' : filename.slice(dotIndex).toLowerCase();
};

const getBrowserCompatibleGalleryFilename = (
  filename: string | null | undefined,
  mimetype: string,
): string => {
  const fallbackName = `media-${Date.now()}`;
  const originalName = filename ?? fallbackName;
  const extension = getFileExtension(originalName);

  if (mimetype === 'image/jpeg' && HEIC_EXTENSIONS.has(extension)) {
    return `${originalName.slice(0, -extension.length)}.jpg`;
  }

  return originalName;
};

export { getAttachmentRejectionReason } from './attachmentPolicy';

const isImageMime = (mime: string): boolean => mime.startsWith('image/');

const withResolvedImageDimensions = async (
  attachment: ComposerAttachment,
): Promise<ComposerAttachment> => {
  if (!isImageMime(attachment.mimetype)) return attachment;

  const dims = await resolveAttachmentImageDimensions(
    attachment.localUri,
    attachment.width,
    attachment.height,
  );

  return {
    ...attachment,
    ...(dims.width !== undefined && { width: dims.width }),
    ...(dims.height !== undefined && { height: dims.height }),
  };
};

const filterSupportedAttachments = (attachments: ComposerAttachment[]): ComposerAttachment[] => {
  const accepted = attachments.filter(
    attachment => getAttachmentRejectionReason(attachment) === null,
  );
  const rejected = attachments.filter(
    attachment => getAttachmentRejectionReason(attachment) !== null,
  );

  if (rejected.length > 0) {
    const first = rejected[0]!;
    throw new Error(getAttachmentRejectionReason(first) ?? 'File type is not allowed');
  }

  return accepted;
};

const toMediaAttachment = (
  asset: ImagePicker.ImagePickerAsset,
  source: 'gallery' | 'camera',
): ComposerAttachment | null => {
  const mimetype = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
  if (!asset.uri || !asset.fileSize) return null;

  return {
    attachmentId: uuidv4(),
    originalFilename: getBrowserCompatibleGalleryFilename(asset.fileName, mimetype),
    mimetype,
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
    localUri: asset.uri,
    thumbnailUri: asset.uri,
    source,
    status: 'local',
  };
};

const toDocumentAttachment = (
  asset: DocumentPicker.DocumentPickerAsset,
): ComposerAttachment | null => {
  const mimetype = asset.mimeType ?? 'application/octet-stream';
  if (!asset.uri || !asset.size) return null;

  return {
    attachmentId: uuidv4(),
    originalFilename: asset.name,
    mimetype,
    size: asset.size,
    localUri: asset.uri,
    source: 'file',
    status: 'local',
  };
};

export const pickFromGallery: AttachmentPicker = async (
  allowedFileTypes,
  remainingSlots = MAX_COMPOSER_ATTACHMENT_COUNT,
): Promise<ComposerAttachment[]> => {
  assertAttachmentCountWithinLimit(0, remainingSlots);
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Media library permission is required.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    quality: 1,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    selectionLimit: remainingSlots,
  });

  if (result.canceled) return [];

  assertAttachmentCountWithinLimit(0, result.assets.length);

  const attachments = await Promise.all(
    result.assets
      .map(asset => toMediaAttachment(asset, 'gallery'))
      .filter((item): item is ComposerAttachment => Boolean(item))
      .filter(item => mimeAllowed(item.mimetype, allowedFileTypes))
      .map(withResolvedImageDimensions),
  );

  const accepted = filterSupportedAttachments(attachments);
  assertAttachmentCountWithinLimit(0, accepted.length);
  return accepted;
};

export const pickFromCamera: AttachmentPicker = async (
  allowedFileTypes,
  remainingSlots = MAX_COMPOSER_ATTACHMENT_COUNT,
): Promise<ComposerAttachment[]> => {
  assertAttachmentCountWithinLimit(0, remainingSlots);
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera permission is required.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images', 'videos'],
    quality: 1,
  });

  if (result.canceled) return [];

  const attachments = await Promise.all(
    result.assets
      .map(asset => toMediaAttachment(asset, 'camera'))
      .filter((item): item is ComposerAttachment => Boolean(item))
      .filter(item => mimeAllowed(item.mimetype, allowedFileTypes))
      .map(withResolvedImageDimensions),
  );

  const accepted = filterSupportedAttachments(attachments);
  assertAttachmentCountWithinLimit(0, accepted.length);
  return accepted;
};

export const pickFromFiles: AttachmentPicker = async (
  allowedFileTypes,
  remainingSlots = MAX_COMPOSER_ATTACHMENT_COUNT,
): Promise<ComposerAttachment[]> => {
  assertAttachmentCountWithinLimit(0, remainingSlots);
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type:
      allowedFileTypes.includes(ALL_FILE_TYPES) || allowedFileTypes.length === 0
        ? ALL_FILE_TYPES
        : allowedFileTypes,
  });

  if (result.canceled) return [];

  assertAttachmentCountWithinLimit(0, result.assets.length);
  if (result.assets.length > remainingSlots) {
    throw new Error(
      `Select up to ${remainingSlots} more file${remainingSlots === 1 ? '' : 's'} to continue.`,
    );
  }

  const attachments = await Promise.all(
    result.assets
      .map(toDocumentAttachment)
      .filter((item): item is ComposerAttachment => Boolean(item))
      .filter(item => mimeAllowed(item.mimetype, allowedFileTypes))
      .map(withResolvedImageDimensions),
  );

  const accepted = filterSupportedAttachments(attachments);
  assertAttachmentCountWithinLimit(0, accepted.length);
  return accepted;
};
