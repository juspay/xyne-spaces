import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import FileViewer from 'react-native-file-viewer';
import { FileText } from 'lucide-react-native';

import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import { formatFileSize } from '@/src/components/chat/message/message-attachments.utils';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

type ExternalHtmlViewerProps = {
  uri: string;
  attachment: AttachmentsViewerItem;
  openDocumentOnAndroid: (attachment: AttachmentsViewerItem, uri: string) => Promise<void>;
  saveAttachmentToDevice: (attachment: AttachmentsViewerItem, uri: string) => void;
};

export const ExternalHtmlViewer = ({
  uri,
  attachment,
  openDocumentOnAndroid,
  saveAttachmentToDevice,
}: ExternalHtmlViewerProps): ReactElement => {
  const [isOpening, setIsOpening] = useState(false);
  const { accentBg } = useBubbleAccent();
  const sizeLabel = attachment.size ? formatFileSize(attachment.size) : '';

  const openExternally = async (): Promise<void> => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      if (Platform.OS === 'android') {
        await openDocumentOnAndroid(attachment, uri);
        return;
      }

      try {
        await FileViewer.open(uri.replace('file://', ''), {
          ...(attachment.originalFilename ? { displayName: attachment.originalFilename } : {}),
        });
      } catch {
        saveAttachmentToDevice(attachment, uri);
      }
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <View className='flex-1 items-center justify-center bg-black px-8'>
      <FileText size={50} color='#9ca3af' strokeWidth={1.6} />
      <Text className='mt-5 text-center text-lg font-semibold text-white' numberOfLines={2}>
        {attachment.originalFilename ?? 'HTML file'}
      </Text>
      <Text className='mt-2 text-center text-sm text-white/60'>
        {['HTML', sizeLabel].filter(Boolean).join(' • ')}
      </Text>
      <Text className='mt-5 text-center text-sm text-white/55'>Open this file</Text>
      <Pressable
        onPress={() => void openExternally()}
        disabled={isOpening}
        accessibilityRole='button'
        accessibilityLabel='Open HTML file'
        className='mt-7 w-full max-w-[260px] items-center rounded-xl py-3.5 active:opacity-80'
        style={{ backgroundColor: accentBg }}
      >
        {isOpening ? (
          <ActivityIndicator color='#fff' />
        ) : (
          <Text className='text-base font-semibold text-white'>Open</Text>
        )}
      </Pressable>
    </View>
  );
};
