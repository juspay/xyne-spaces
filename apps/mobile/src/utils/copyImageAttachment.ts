import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';

import { isImageFile } from '@/src/components/chat/message/message-attachments.utils';
import { cacheMtlsAttachmentFile } from '@/src/hooks/useMtlsAttachmentFile';

type ImageAttachmentLike = {
  id: string;
  mimetype: string;
  originalFilename?: string | null;
};

const getFirstImageAttachment = (
  attachments: ReadonlyArray<ImageAttachmentLike> | null | undefined,
): ImageAttachmentLike | null =>
  (attachments ?? []).find(attachment => isImageFile(attachment.mimetype)) ?? null;

const copyImageAttachmentToClipboard = async (attachment: ImageAttachmentLike): Promise<void> => {
  const { uri } = await cacheMtlsAttachmentFile(attachment.id, attachment.originalFilename);
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Clipboard.setImageAsync(base64);
};

export { copyImageAttachmentToClipboard, getFirstImageAttachment };
export type { ImageAttachmentLike };
