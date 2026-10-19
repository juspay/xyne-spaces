import { ReactElement, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LegendList } from '@legendapp/list/react-native';
import { Globe, Lock, NotebookText, Users } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { CanvasVisibility, type Canvas, type CanvasParticipant } from '@xyne/shared';

import { useQuery } from '@/src/hooks/useQuery';
import { haptics } from '@/src/utils/haptics';
import { queries } from '@/src/zero/queries';
import { CanvasHeaderV3 } from '@/src/components/chat/canvas-header-v3';

const HEADER_RESERVED = 60;
const ROW_MIN_HEIGHT = 72;

type CanvasRow = Canvas & {
  participants?: readonly CanvasParticipant[];
};

const formatRelative = (ts?: number | null): string => {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

const CanvasCard = ({
  canvas,
  onPress,
  mutedForeground,
}: {
  canvas: CanvasRow;
  onPress: () => void;
  mutedForeground: string;
}): ReactElement => {
  const isPublic = canvas.visibility === CanvasVisibility.PUBLIC;
  const VisibilityIcon = isPublic ? Globe : Lock;
  const participantCount = canvas.participants?.length ?? 0;
  const updated = formatRelative(canvas.updatedAt);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      className='mx-4 my-1 flex-row items-start gap-3 rounded-lg border border-border bg-card p-3'
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      <View
        className='items-center justify-center rounded bg-muted'
        style={{ width: 32, height: 32, marginTop: 2 }}
      >
        <NotebookText size={16} color={mutedForeground} strokeWidth={1.75} />
      </View>
      <View className='min-w-0 flex-1'>
        <Text className='text-sm font-medium text-foreground' numberOfLines={1}>
          {canvas.title || 'Untitled canvas'}
        </Text>
        <View className='mt-1 flex-row items-center gap-3'>
          <View className='flex-row items-center gap-1'>
            <VisibilityIcon size={11} color={mutedForeground} strokeWidth={1.75} />
            <Text className='text-[11px] text-secondary-foreground'>
              {isPublic ? 'Public' : 'Private'}
            </Text>
          </View>
          {participantCount > 0 && (
            <View className='flex-row items-center gap-1'>
              <Users size={11} color={mutedForeground} strokeWidth={1.75} />
              <Text className='text-[11px] text-secondary-foreground'>{participantCount}</Text>
            </View>
          )}
          {updated ? (
            <Text className='text-[11px] text-secondary-foreground'>{updated}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

const CanvasScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;

  const [canvases] = useQuery(
    queries.channelCanvasesPaginated({
      channelId,
      includeQuartoDocs: false,
      limit: 25,
      start: null,
    }),
    { enabled: !!channelId },
  );

  const items = useMemo(
    (): CanvasRow[] => (Array.isArray(canvases) ? (canvases as CanvasRow[]) : []),
    [canvases],
  );

  const openCanvas = (canvas: CanvasRow): void => {
    router.push({
      pathname: '/(protected)/canvas',
      params: { channelId, canvasId: canvas.id, tab: 'canvas' },
    });
  };

  return (
    <View className='flex-1 bg-background'>
      <CanvasHeaderV3 channelId={channelId} />

      {items.length === 0 ? (
        <View className='flex-1 items-center justify-center px-8'>
          <NotebookText size={48} color={foregroundColor} opacity={0.3} />
          <Text className='mt-4 text-center text-sm font-medium text-foreground'>
            No canvases yet
          </Text>
          <Text className='mt-1 text-center text-xs text-secondary-foreground'>
            Canvases shared in this channel will appear here.
          </Text>
        </View>
      ) : (
        <LegendList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            paddingTop: insets.top + HEADER_RESERVED,
            paddingBottom: insets.bottom + 16,
          }}
          renderItem={({ item }) => (
            <CanvasCard
              canvas={item}
              onPress={() => openCanvas(item)}
              mutedForeground={mutedForeground}
            />
          )}
          estimatedItemSize={ROW_MIN_HEIGHT + 8}
        />
      )}
    </View>
  );
};

export default CanvasScreen;
