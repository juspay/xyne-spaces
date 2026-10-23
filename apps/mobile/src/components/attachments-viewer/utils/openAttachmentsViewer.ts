import type { ImperativeRouter as Router } from 'expo-router';
import { Platform } from 'react-native';

import {
  attachmentsActor,
  type AttachmentsViewerItem,
  type AttachmentsViewerSource,
} from '@/src/machines/attachmentsMachine';
import { getAttachmentFileCategory } from './file-viewer';

type OpenPayload = {
  attachments: AttachmentsViewerItem[];
  initialIndex?: number;
  source?: AttachmentsViewerSource;
};

// Debounce window so a double-tap can't push two QuickLook loaders.
const QUICK_LOOK_DEBOUNCE_MS = 1000;
let lastQuickLookOpenAt = 0;

const openInGallery = (router: Router, payload: OpenPayload): void => {
  attachmentsActor.send({
    type: 'OPEN',
    attachments: payload.attachments,
    ...(payload.initialIndex !== undefined && { initialIndex: payload.initialIndex }),
    ...(payload.source !== undefined && { source: payload.source }),
  });
  router.push('/attachments-viewer');
};

export const openAttachmentsViewer = (router: Router, payload: OpenPayload): void => {
  if (!payload.attachments || payload.attachments.length === 0) return;

  if (Platform.OS === 'ios') {
    const index = Math.max(0, payload.initialIndex ?? 0);
    const initial = payload.attachments[index];
    // Office / unsupported docs go straight to QuickLook (via the loading screen)
    // instead of the in-app "Preview" screen. PDFs, media, and text use the gallery.
    if (
      initial &&
      getAttachmentFileCategory(initial.mimetype, initial.originalFilename) === 'unsupported'
    ) {
      const now = Date.now();
      if (now - lastQuickLookOpenAt < QUICK_LOOK_DEBOUNCE_MS) return;
      lastQuickLookOpenAt = now;
      router.push({
        pathname: '/quick-look',
        params: { id: initial.id, filename: initial.originalFilename ?? '' },
      });
      return;
    }
  }

  openInGallery(router, payload);
};
