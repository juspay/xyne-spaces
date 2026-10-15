import { type ReactElement, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
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
  return (
    <Pressable
      accessibilityRole='button'
      disabled={disabled}
      onPress={onPress}
      className='rounded-full bg-brand px-5 py-3'
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.75 : 1, minHeight: 44 })}
    >
      <Text className='text-center font-semibold text-[#171d29]'>{children}</Text>
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
export function Avatar({ name }: { name: string }): ReactElement {
  return (
    <View className='h-10 w-10 items-center justify-center rounded-full bg-accent'>
      <Text className='font-semibold text-foreground'>
        {name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map(part => part[0])
          .join('')
          .toUpperCase()}
      </Text>
    </View>
  );
}
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
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
          <View className='flex-row items-center justify-between border-b border-border px-5 py-4'>
            <Text className='text-lg font-bold text-foreground'>{title}</Text>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Close'
              onPress={onClose}
              className='rounded-full bg-secondary p-2'
            >
              <X color={color} size={22} />
            </Pressable>
          </View>
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
