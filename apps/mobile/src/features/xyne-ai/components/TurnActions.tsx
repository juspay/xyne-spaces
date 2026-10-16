import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';

import { rateXyneAIMessage, type Rating } from '../api/xyneAIStream';
import { useSheetBottomPadding } from './PickerSheet';

const MAX_COMMENT_LENGTH = 500;
const COPIED_MS = 1500;

const RatingCommentSheet = ({
  isOpen,
  onOpenChange,
  onSubmit,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (comment: string) => void;
}): ReactElement => {
  const [comment, setComment] = useState('');
  const paddingBottom = useSheetBottomPadding();
  const placeholderColor = useCSSVariable('--color-secondary-foreground') as string;
  const foreground = useCSSVariable('--color-foreground') as string;

  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={onOpenChange} mode='dynamic'>
      <BottomSheetView style={{ paddingBottom }}>
        <View className='gap-3 px-4 pt-1'>
          <Text className='text-[15px] font-semibold text-foreground'>What went wrong?</Text>
          <BottomSheetTextInput
            value={comment}
            onChangeText={setComment}
            maxLength={MAX_COMMENT_LENGTH}
            multiline
            placeholder='Tell us more (optional)'
            placeholderTextColor={placeholderColor}
            className='min-h-[96px] rounded-xl border border-border p-3 text-[15px]'
            style={{ color: foreground, textAlignVertical: 'top' }}
          />
          <Pressable
            accessibilityRole='button'
            onPress={(): void => {
              onSubmit(comment.trim());
              setComment('');
            }}
            className='h-11 items-center justify-center rounded-xl bg-brand active:opacity-80'
          >
            <Text className='text-[15px] font-medium text-white'>Send</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
};

const ActionButton = ({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactElement;
}): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={label}
    hitSlop={8}
    onPress={(): void => {
      void haptics.buttonTap();
      onPress();
    }}
    className='p-1 active:opacity-60'
  >
    {children}
  </Pressable>
);

const CopyButton = ({ text, color }: { text: string; color: string }): ReactElement => {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? Check : Copy;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return (): void => clearTimeout(timer);
  }, [copied]);

  return (
    <ActionButton
      label='Copy answer'
      onPress={(): void => {
        void Clipboard.setStringAsync(text);
        setCopied(true);
      }}
    >
      <Icon size={16} color={color} />
    </ActionButton>
  );
};

export const TurnActions = ({
  answer,
  messageId,
  initialRating,
  onRegenerate,
}: {
  answer: string;
  messageId: string | undefined;
  initialRating: Rating | undefined;
  onRegenerate: (() => void) | undefined;
}): ReactElement => {
  const [rating, setRating] = useState(initialRating);
  const [isCommenting, setIsCommenting] = useState(false);
  const color = useCSSVariable('--color-secondary-foreground') as string;
  const selected = useCSSVariable('--color-foreground') as string;

  const rate = (next: Rating, comment?: string): void => {
    if (!messageId) return;
    const previous = rating;
    setRating(next);
    rateXyneAIMessage(messageId, next, comment).catch(() => setRating(previous));
  };

  const thumb = (icon: typeof ThumbsUp, own: Rating): ReactElement => {
    const Icon = icon;
    return (
      <Icon
        size={16}
        color={rating === own ? selected : color}
        fill={rating === own ? selected : 'none'}
        fillOpacity={0.3}
      />
    );
  };

  return (
    <View className='-ml-1 flex-row items-center gap-1'>
      {answer !== '' ? <CopyButton text={answer} color={color} /> : null}
      {messageId ? (
        <>
          <ActionButton label='Helpful' onPress={(): void => rate('up')}>
            {thumb(ThumbsUp, 'up')}
          </ActionButton>
          <ActionButton
            label='Not helpful'
            onPress={(): void => {
              if (rating !== 'down') rate('down');
              setIsCommenting(true);
            }}
          >
            {thumb(ThumbsDown, 'down')}
          </ActionButton>
        </>
      ) : null}
      {onRegenerate ? (
        <ActionButton label='Regenerate response' onPress={onRegenerate}>
          <RefreshCw size={16} color={color} />
        </ActionButton>
      ) : null}
      <RatingCommentSheet
        isOpen={isCommenting}
        onOpenChange={setIsCommenting}
        onSubmit={(comment): void => {
          setIsCommenting(false);
          if (comment) rate('down', comment);
        }}
      />
    </View>
  );
};
