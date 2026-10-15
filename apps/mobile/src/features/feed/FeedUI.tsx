import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { formatDistanceToNowStrict } from 'date-fns';
import { type ReactElement, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { feedError } from './api';
export function Button({
  children,
  onPress,
  disabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
}): ReactElement {
  const { accentBg, accentFg } = useBubbleAccent();
  return (
    <Pressable
      accessibilityRole='button'
      disabled={disabled}
      onPress={onPress}
      className='rounded-full px-5 py-3'
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        minHeight: 44,
        backgroundColor: accentBg,
      })}
    >
      <Text style={{ color: accentFg }} className='text-center font-bold'>
        {children}
      </Text>
    </Pressable>
  );
}
export function Notice({ error, retry }: { error: unknown; retry: () => void }): ReactElement {
  return (
    <View className='gap-3 p-5'>
      <Text className='text-foreground'>{feedError(error)}</Text>
      <Button onPress={retry}>Try again</Button>
    </View>
  );
}
export function Sheet({
  title,
  children,
  onClose,
  action,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  action?: ReactNode;
}): ReactElement {
  const color = useCSSVariable('--color-foreground') as string;
  const background = useCSSVariable('--color-card') as string;
  return (
    <Modal visible animationType='slide' onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View className='min-h-14 flex-row items-center gap-5 border-b border-border px-3'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Close'
              onPress={onClose}
              className='h-11 w-11 items-center justify-center'
            >
              <ArrowLeft color={color} size={23} />
            </Pressable>
            <Text className='flex-1 text-xl font-bold text-foreground'>{title}</Text>
            {action}
          </View>
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export function feedTime(value: string): string {
  return formatDistanceToNowStrict(new Date(value))
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y');
}
