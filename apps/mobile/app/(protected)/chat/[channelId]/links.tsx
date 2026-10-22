import { ReactElement, useMemo } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { LegendList } from '@legendapp/list/react-native';
import { Globe, Link as LinkIcon, Lock } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { LinkVisibility } from '@xyne/shared';
import { QueryResultType } from '@rocicorp/zero';

import { useQuery } from '@/src/hooks/useQuery';
import { haptics } from '@/src/utils/haptics';
import { queries } from '@/src/zero/queries';
import { useAuthContextValues } from '@/src/contexts/AuthContext';
import { LinksHeaderV3 } from '@/src/components/chat/links-header-v3';
import { isSafeExternalUrl } from '@/src/utils/webViewSecurity';

const HEADER_RESERVED = 60;
const ROW_MIN_HEIGHT = 64;

type LinkRow = QueryResultType<ReturnType<typeof queries.channelLinks>>[number];

type SectionRow = { kind: 'section'; id: string; label: string; count: number };
type ItemRow = { kind: 'item'; id: string; link: LinkRow; isSharedWithMe: boolean };
type Row = SectionRow | ItemRow;

const openUrl = async (url: string): Promise<void> => {
  try {
    if (!isSafeExternalUrl(url)) {
      Alert.alert('Unable to open link', url);
      return;
    }
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Unable to open link', url);
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open link', url);
  }
};

const LinkCard = ({
  link,
  isSharedWithMe,
  mutedForeground,
}: {
  link: LinkRow;
  isSharedWithMe: boolean;
  mutedForeground: string;
}): ReactElement => (
  <Pressable
    onPress={() => openUrl(link.url)}
    onPressIn={(): void => {
      void haptics.buttonTap();
    }}
    className='mx-4 my-1 flex-row items-start gap-3 rounded-lg border border-border bg-card p-3'
    style={{ minHeight: ROW_MIN_HEIGHT }}
  >
    <View
      className='items-center justify-center overflow-hidden rounded'
      style={{ width: 24, height: 24, marginTop: 2 }}
    >
      {link.favicon ? (
        <Image
          source={{ uri: link.favicon }}
          style={{ width: 16, height: 16 }}
          cachePolicy='memory-disk'
          recyclingKey={link.id}
          contentFit='contain'
        />
      ) : (
        <LinkIcon size={16} color={mutedForeground} strokeWidth={1.5} />
      )}
    </View>
    <View className='min-w-0 flex-1'>
      <View className='flex-row items-center gap-2'>
        <Text className='flex-1 text-sm font-medium text-foreground' numberOfLines={1}>
          {link.title}
        </Text>
        {isSharedWithMe && (
          <View className='rounded bg-purple-100 px-1.5 py-0.5 dark:bg-purple-900/30'>
            <Text className='text-[10px] font-medium text-purple-700 dark:text-purple-300'>
              Shared
            </Text>
          </View>
        )}
      </View>
      <Text className='mt-0.5 text-xs text-secondary-foreground' numberOfLines={1}>
        {link.url}
      </Text>
      {link.description ? (
        <Text className='mt-1 text-xs text-secondary-foreground' numberOfLines={2}>
          {link.description}
        </Text>
      ) : null}
    </View>
  </Pressable>
);

const SectionHeader = ({
  label,
  count,
  icon,
  mutedForeground,
}: {
  label: string;
  count: number;
  icon: 'globe' | 'lock';
  mutedForeground: string;
}): ReactElement => {
  const Icon = icon === 'globe' ? Globe : Lock;
  return (
    <View className='flex-row items-center gap-2 px-4 pb-2 pt-4'>
      <Icon size={14} color={mutedForeground} strokeWidth={1.75} />
      <Text className='text-xs font-semibold uppercase tracking-wide text-secondary-foreground'>
        {label}
      </Text>
      <Text className='text-xs text-secondary-foreground'>{count}</Text>
    </View>
  );
};

const LinksScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const { userID: currentUserId } = useAuthContextValues();
  const insets = useSafeAreaInsets();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;

  const [links] = useQuery(queries.channelLinks({ channelId }), { enabled: !!channelId });

  const { rows, isEmpty } = useMemo(() => {
    const list = links ?? [];
    const shared = list.filter(l => l.visibility === LinkVisibility.DEFAULT);
    const personal = list.filter(
      l =>
        l.visibility === LinkVisibility.PERSONAL ||
        l.sharedWith?.some(sw => sw.userId === currentUserId),
    );

    const out: Row[] = [];
    if (shared.length > 0) {
      out.push({ kind: 'section', id: 'sec-shared', label: 'Public', count: shared.length });
      shared.forEach(l =>
        out.push({ kind: 'item', id: `shared-${l.id}`, link: l, isSharedWithMe: false }),
      );
    }
    if (personal.length > 0) {
      out.push({ kind: 'section', id: 'sec-personal', label: 'Personal', count: personal.length });
      personal.forEach(l => {
        const isOwner = l.createdBy === currentUserId;
        out.push({
          kind: 'item',
          id: `personal-${l.id}`,
          link: l,
          isSharedWithMe: !isOwner && l.visibility === LinkVisibility.PERSONAL,
        });
      });
    }
    return { rows: out, isEmpty: list.length === 0 };
  }, [links, currentUserId]);

  return (
    <View className='flex-1 bg-settings-bg'>
      <LinksHeaderV3 channelId={channelId} />

      {isEmpty ? (
        <View className='flex-1 items-center justify-center px-8'>
          <LinkIcon size={48} color={foregroundColor} opacity={0.3} />
          <Text className='mt-4 text-center text-sm font-medium text-foreground'>No links yet</Text>
          <Text className='mt-1 text-center text-xs text-secondary-foreground'>
            Links shared in this channel will appear here.
          </Text>
        </View>
      ) : (
        <LegendList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            paddingTop: insets.top + HEADER_RESERVED,
            paddingBottom: insets.bottom + 16,
          }}
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              return (
                <SectionHeader
                  label={item.label}
                  count={item.count}
                  icon={item.label === 'Public' ? 'globe' : 'lock'}
                  mutedForeground={mutedForeground}
                />
              );
            }
            return (
              <LinkCard
                link={item.link}
                isSharedWithMe={item.isSharedWithMe}
                mutedForeground={mutedForeground}
              />
            );
          }}
          estimatedItemSize={ROW_MIN_HEIGHT + 8}
        />
      )}
    </View>
  );
};

export default LinksScreen;
