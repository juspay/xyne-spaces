import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight, File } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { getFileTypeConfig } from '@/src/components/chat/file-attachment-card';

import {
  FILE_CARD_ICON_SIZE,
  FILE_CARD_MIN_HEIGHT,
  FILE_CARD_PADDING,
  FILE_CARD_RADIUS,
} from '../constants';
import { fileCardSubtitle } from '../model/file-card';

type FileCardProps = {
  fileName: string;
  mimetype: string;
  senderName: string;
  timeLabel: string;
  onPress: () => void;
};

export const FileCard = memo(function FileCard({
  fileName,
  mimetype,
  senderName,
  timeLabel,
  onPress,
}: FileCardProps): ReactElement {
  const subtle = useCSSVariable('--color-spaces-subtle') as string;
  const muted = useCSSVariable('--color-spaces-muted') as string;
  const typeLabel = getFileTypeConfig(mimetype, fileName).label;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${fileName}`}
      onPress={onPress}
      className='flex-row items-center border border-spaces-outline bg-spaces-background shadow-xs'
      style={{
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
        <Text className='text-[13px] leading-4 text-spaces-subtle' numberOfLines={1}>
          {fileCardSubtitle(typeLabel, senderName)}
        </Text>
      </View>
      <Text className='text-[13px] leading-4 text-spaces-subtle'>{timeLabel}</Text>
      <ChevronRight size={16} color={subtle} />
    </Pressable>
  );
});
