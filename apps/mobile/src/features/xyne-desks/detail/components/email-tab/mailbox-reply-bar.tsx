import { memo, type ReactElement } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import { Reply } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

export const MAILBOX_REPLY_BAR_HEIGHT = 68;

type MailboxReplyBarProps = {
  bottomInset: number;
  onReplyPress?: (() => void) | undefined;
};

export const MailboxReplyBar = memo(function MailboxReplyBar({
  bottomInset,
  onReplyPress,
}: MailboxReplyBarProps): ReactElement {
  const scheme = useColorScheme();
  const screenBackground = useCSSVariable('--color-tabs-screen') as string;

  const buttonBackground = scheme === 'dark' ? 'rgba(232, 222, 248, 0.18)' : '#F1E6FF';
  const buttonBorder = scheme === 'dark' ? 'rgba(232, 222, 248, 0.24)' : 'rgba(103, 58, 183, 0.18)';
  const contentColor = scheme === 'dark' ? '#F8F2FF' : '#352B3D';

  return (
    <View
      pointerEvents='box-none'
      className='absolute inset-x-0 bottom-0 z-30 items-start px-5 pt-3'
      style={{
        paddingBottom: Math.max(bottomInset, 12),
        backgroundColor: screenBackground,
      }}
    >
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Reply to email'
        hitSlop={8}
        onPress={onReplyPress}
        className='flex-row items-center justify-center gap-2 overflow-hidden w-full'
        style={({ pressed }) => ({
          minWidth: 156,
          height: 56,
          paddingHorizontal: 28,
          borderRadius: 999,
          backgroundColor: buttonBackground,
          borderColor: buttonBorder,
          borderWidth: 0.5,
          opacity: pressed ? 0.82 : 1,
          shadowColor: '#000',
          shadowOpacity: scheme === 'dark' ? 0.22 : 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 5 },
          elevation: 0.1,
        })}
      >
        <Reply size={21} color={contentColor} strokeWidth={2.4} />
        <Text className='text-[16px] font-semibold' style={{ color: contentColor }}>
          Reply
        </Text>
      </Pressable>
    </View>
  );
});
