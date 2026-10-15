import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MessageCircle, UserRound } from 'lucide-react-native';
import Avatar from '@/src/components/ui/avatar';
import { useAuth } from '@/src/contexts/AuthContext';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { ChannelService } from '@/src/services/ChannelService';
import { feedError } from './api';

function AuthorActions({
  userId,
  name,
  onClose,
  onNavigate,
}: {
  userId: string;
  name: string;
  onClose: () => void;
  onNavigate?: (() => void) | undefined;
}): ReactElement {
  const router = useRouter();
  const { token, user } = useAuth();
  const { accentText } = useBubbleAccent();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return (): void => {
      mounted.current = false;
    };
  }, []);
  const ownProfile = user?.user_id === userId;
  const message = async (): Promise<void> => {
    if (busy || ownProfile) return;
    setBusy(true);
    try {
      const dm = await new ChannelService(token).createDm({ participantIds: [userId] });
      if (!mounted.current) return;
      onClose();
      onNavigate?.();
      router.push(`/(protected)/chat/${dm.id}`);
    } catch (error) {
      if (mounted.current) Alert.alert('Could not start conversation', feedError(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Modal transparent visible animationType='fade' onRequestClose={onClose}>
      <View className='flex-1 justify-end'>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Close user actions'
          onPress={onClose}
          className='absolute inset-0 bg-black/40'
        />
        <View
          className='rounded-t-3xl bg-card px-5 pt-3'
          style={{ paddingBottom: insets.bottom + 20 }}
        >
          <View className='mb-5 h-1 w-10 self-center rounded-full bg-border' />
          <View className='mb-4 flex-row items-center gap-3'>
            <Avatar userIds={[userId]} fallbackUsers={[{ id: userId, name }]} size={48} rounded />
            <Text className='flex-1 text-lg font-bold text-foreground'>{name}</Text>
          </View>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='View profile'
            onPress={() => {
              onClose();
              onNavigate?.();
              router.push(`/profile/${userId}`);
            }}
            className='min-h-14 flex-row items-center gap-4 py-4'
          >
            <UserRound size={22} color={accentText} />
            <Text className='text-base font-medium text-foreground'>View profile</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Send message'
            disabled={busy || ownProfile}
            onPress={() => {
              void message();
            }}
            className='min-h-14 flex-row items-center gap-4 py-4'
            style={{ opacity: busy || ownProfile ? 0.45 : 1 }}
          >
            {busy ? (
              <ActivityIndicator color={accentText} />
            ) : (
              <MessageCircle size={22} color={accentText} />
            )}
            <Text className='text-base font-medium text-foreground'>Send message</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function FeedAuthor({
  userId,
  name,
  avatar = false,
  onNavigate,
}: {
  userId: string;
  name: string;
  avatar?: boolean;
  onNavigate?: (() => void) | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`User actions for ${name}`}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={avatar ? { alignSelf: 'flex-start' } : { flexShrink: 1 }}
      >
        {avatar ? (
          <Avatar userIds={[userId]} fallbackUsers={[{ id: userId, name }]} size={40} rounded />
        ) : (
          <Text numberOfLines={1} className='text-[15px] font-bold text-foreground'>
            {name}
          </Text>
        )}
      </Pressable>
      {open ? (
        <AuthorActions
          userId={userId}
          name={name}
          onClose={() => setOpen(false)}
          onNavigate={onNavigate}
        />
      ) : null}
    </>
  );
}
