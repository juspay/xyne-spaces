import { type ComponentType, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  Archive,
  Download,
  FileCode,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
  type LucideProps,
} from 'lucide-react-native';

import {
  formatFileSize,
  truncateFileName,
} from '@/src/components/chat/message/message-attachments.utils';
import { FILE_ATTACHMENT_CARD_HEIGHT } from '@/src/components/conversation-composer/attachment-layout';

type FileAttachment = {
  id?: string;
  originalFilename: string;
  mimetype: string;
  size: number;
};

export type FileTypeConfig = {
  icon: ComponentType<LucideProps>;
  color: string;
  label: string;
};

const codeExtensionPattern =
  /\.(ts|tsx|js|jsx|py|rb|go|java|c|cpp|cs|sql|yml|yaml|json|md|html|css)$/i;

export const getFileTypeConfig = (mimetype: string, fileName: string): FileTypeConfig => {
  if (mimetype.startsWith('image/')) {
    return { icon: ImageIcon, color: '#3b82f6', label: 'Image' };
  }

  if (mimetype.startsWith('video/')) {
    return { icon: Video, color: '#a855f7', label: 'Video' };
  }

  if (mimetype.startsWith('audio/')) {
    return { icon: Music, color: '#22c55e', label: 'Audio' };
  }

  if (mimetype === 'application/pdf') {
    return { icon: FileText, color: '#ef4444', label: 'PDF' };
  }

  if (
    mimetype === 'application/msword' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return { icon: FileText, color: '#2563eb', label: 'Word' };
  }

  if (
    mimetype === 'application/vnd.ms-excel' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'text/csv'
  ) {
    return { icon: FileText, color: '#16a34a', label: 'Excel' };
  }

  if (
    mimetype === 'application/vnd.ms-powerpoint' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return { icon: FileText, color: '#f97316', label: 'PowerPoint' };
  }

  if (
    mimetype === 'application/zip' ||
    mimetype === 'application/x-zip-compressed' ||
    mimetype === 'application/x-7z-compressed' ||
    mimetype === 'application/x-tar' ||
    mimetype === 'application/gzip' ||
    mimetype.includes('archive') ||
    mimetype.includes('compressed')
  ) {
    return { icon: Archive, color: '#eab308', label: 'Archive' };
  }

  if (
    codeExtensionPattern.test(fileName) ||
    mimetype.includes('javascript') ||
    mimetype.includes('typescript') ||
    mimetype.includes('python') ||
    mimetype.includes('json') ||
    mimetype.includes('xml') ||
    mimetype.includes('yaml') ||
    mimetype.includes('sql')
  ) {
    return { icon: FileCode, color: '#64748b', label: 'Code' };
  }

  if (mimetype === 'text/plain' || fileName.endsWith('.txt')) {
    return { icon: FileText, color: '#6b7280', label: 'Plain Text' };
  }

  if (mimetype === 'text/markdown' || fileName.endsWith('.md')) {
    return { icon: FileText, color: '#4b5563', label: 'Markdown' };
  }

  return { icon: FileText, color: '#9ca3af', label: 'File' };
};

export const FileAttachmentCard = ({
  attachment,
  onPress,
}: {
  attachment: FileAttachment;
  onPress?: () => void;
}): ReactElement => {
  const fileName = truncateFileName(attachment.originalFilename, 30);
  const fileSize = formatFileSize(attachment.size);
  const config = getFileTypeConfig(attachment.mimetype, attachment.originalFilename);
  const Icon = config.icon;

  return (
    <Pressable
      onPress={onPress}
      className='flex-row items-center'
      style={({ pressed }) => [
        { width: '100%', minWidth: 256, maxWidth: 360, height: FILE_ATTACHMENT_CARD_HEIGHT },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View
        className='flex-row items-center'
        style={{
          width: '100%',
          borderRadius: 10,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.14)',
          backgroundColor: 'rgba(18,20,22,0.86)',
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 12,
        }}
      >
        <View
          className='items-center justify-center'
          style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: config.color }}
        >
          <Icon size={28} color='#fff' strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: '#f2f2f2', fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={{ color: '#a9adb3', fontSize: 13, marginTop: 4 }} numberOfLines={1}>
            {config.label} • {fileSize}
          </Text>
        </View>
        <View className='items-center justify-center' style={{ width: 32, height: 32 }}>
          <Download size={20} color='#a9adb3' strokeWidth={2} />
        </View>
      </View>
    </Pressable>
  );
};
