import { Alert } from 'react-native';

import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import { ATTACHMENT_PICKER_FILE_TYPES } from '@/src/components/input-composer/utils/attachments';
import {
  pickFromCamera,
  pickFromFiles,
  pickFromGallery,
} from '@/src/components/input-composer/utils/composer-attachments-picker';

type MailboxAttachmentSource = 'gallery' | 'camera' | 'file';

function promptMailboxAttachmentSource(): Promise<MailboxAttachmentSource | null> {
  return new Promise(resolve => {
    Alert.alert('Add attachment', undefined, [
      { text: 'Photo & Video', onPress: () => resolve('gallery') },
      { text: 'Camera', onPress: () => resolve('camera') },
      { text: 'Files', onPress: () => resolve('file') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

export async function pickMailboxEmailAttachments(): Promise<ComposerAttachment[]> {
  const source = await promptMailboxAttachmentSource();
  if (!source) return [];

  const fileTypes = [...ATTACHMENT_PICKER_FILE_TYPES];
  if (source === 'gallery') return pickFromGallery(fileTypes);
  if (source === 'camera') return pickFromCamera(fileTypes);
  return pickFromFiles(fileTypes);
}
