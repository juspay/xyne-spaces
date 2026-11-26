import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight, File } from 'lucide-react-native';

import { getFileTypeConfig } from '@/src/components/chat/file-attachment-card';

import {
  FILE_CARD_CHEVRON_SIZE,
  FILE_CARD_ICON_SIZE,
  FILE_CARD_MIN_HEIGHT,
  FILE_CARD_PADDING,
  FILE_CARD_RADIUS,
  FILE_CARD_SHADOW,
} from '../constants';
import { fileCardSubtitle } from '../model/file-card';
import { useConversationPalette } from './conversation-palette';

type FileCardProps = {
  attachmentId: string;
  fileName: string;
  mimetype: string;
  sizeBytes: number | null | undefined;
  senderName: string;
  timeLabel: string;
  /** Called with `attachmentId`, so the list can pass one stable handler to every card. */
  onOpen: (attachmentId: string) => void;
};

export const FileCard = memo(function FileCard({
  attachmentId,
  fileName,
  mimetype,
  sizeBytes,
  senderName,
  timeLabel,
  onOpen,
}: FileCardProps): ReactElement {
  const { subtle, muted } = useConversationPalette();
  const typeLabel = getFileTypeConfig(mimetype, fileName).label;
  const handlePress = useCallback((): void => onOpen(attachmentId), [attachmentId, onOpen]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${fileName}`}
      onPress={handlePress}
      className='flex-row items-center border border-spaces-outline bg-spaces-background'
      style={{
        boxShadow: FILE_CARD_SHADOW,
        minHeight: FILE_CARD_MIN_HEIGHT,
        borderRadius: FILE_CARD_RADIUS,
        padding: FILE_CARD_PADDING,
        gap: FILE_CARD_PADDING,
      }}
    >
      <File size={FILE_CARD_ICON_SIZE} color={muted} />
      <View className='min-w-0 flex-1'>
        <Text
          className='text-[14px] font-medium leading-[18px] tracking-[-0.14px] text-spaces-foreground'
          numberOfLines={1}
          ellipsizeMode='middle'
        >
          {fileName}
        </Text>
        <Text className='text-[12px] leading-4 text-spaces-subtle' numberOfLines={1}>
          {fileCardSubtitle(typeLabel, sizeBytes, senderName)}
        </Text>
      </View>
      <Text className='text-[12px] leading-4 text-spaces-subtle'>{timeLabel}</Text>
      <ChevronRight size={FILE_CARD_CHEVRON_SIZE} color={subtle} />
    </Pressable>
  );
});
