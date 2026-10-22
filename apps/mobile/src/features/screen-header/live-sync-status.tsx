import { useRouter, type Href } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  CONNECTION_STATE_COPY,
  CONNECTION_STATE_ORDER,
  LIVE_SYNC_GUIDE_ID,
  LIVE_SYNC_TITLE,
} from '@/src/components/connection-status-sheet';
import { ConnectingSpinner } from '@/src/components/connection-status-sheet/connecting-spinner';
import {
  useLiveSyncStatus,
  type LiveSyncStatus,
} from '@/src/components/connection-status-sheet/use-live-sync-status';
import { Tray } from '@/src/ui/tray';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

const LIVE_SYNC_VIEW = 'live-sync';
const DOT_SIZE = 8;
const STATE_ROW_HEIGHT = 36;
const BUTTON_HEIGHT = 48;

function Dot({ color, size = DOT_SIZE }: { color: string; size?: number }): ReactElement {
  return (
    <View
      accessible={false}
      className='rounded-full'
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

/**
 * The live-sync dot for a redesigned screen's header, as the classic header
 * shows it: just the dot while connected, the state's name otherwise, and a
 * spinning glyph while connecting. Tapping it explains the states in a tray.
 */
export function LiveSyncStatus(): ReactElement {
  const status = useLiveSyncStatus();
  const [isOpen, setIsOpen] = useState(false);
  const muted = useCSSVariable('--color-spaces-muted') as string;

  const { stateName, current } = status;

  return (
    <>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Live sync: ${current.label}`}
        accessibilityHint='Shows what the connection status means'
        hitSlop={8}
        onPress={() => {
          void haptics.buttonTap();
          setIsOpen(true);
        }}
        className='flex-row items-center gap-1.5 active:opacity-60'
      >
        <Dot color={current.dotColor} />
        {stateName !== 'connected' ? (
          <Text className='text-[12px] text-spaces-muted'>{current.label}</Text>
        ) : null}
        {stateName === 'connecting' ? <ConnectingSpinner color={muted} /> : null}
      </Pressable>

      <Tray.Root open={isOpen} onOpenChange={setIsOpen} defaultView={LIVE_SYNC_VIEW}>
        <Tray.Content>
          <Tray.Body>
            <Tray.View name={LIVE_SYNC_VIEW} style={{ flexShrink: 1 }}>
              <LiveSyncView status={status} onClose={() => setIsOpen(false)} />
            </Tray.View>
          </Tray.Body>
        </Tray.Content>
      </Tray.Root>
    </>
  );
}

/**
 * Where the connection is and what to do about it, then one line per state.
 *
 * The compact counterpart of the classic sheet: the advice and the Refresh
 * button only appear when there is something to do, and each state is a word
 * and a few more rather than a sentence.
 */
function LiveSyncView({
  status,
  onClose,
}: {
  status: LiveSyncStatus;
  onClose: () => void;
}): ReactElement {
  const router = useRouter();
  const onAccent = useCSSVariable('--color-spaces-accent-foreground') as string;

  const { current, reason, refresh } = status;
  const needsAttention = current.tone !== 'good';

  return (
    <View className='px-5 pt-5 pb-3' style={{ flexShrink: 1 }}>
      <View className='flex-row items-center gap-2.5'>
        <Dot color={current.dotColor} size={12} />
        <Text className='flex-1 text-[18px] font-semibold text-spaces-foreground'>
          {LIVE_SYNC_TITLE}
        </Text>
        <Text className='text-[15px] text-spaces-muted'>{current.label}</Text>
      </View>

      {needsAttention ? (
        <View className='pt-2'>
          <Text className='text-[15px] leading-[21px] text-spaces-foreground'>
            {current.whatToDo}
          </Text>
          {reason !== undefined ? (
            <Text numberOfLines={2} className='pt-1 text-[12px] text-spaces-muted'>
              {reason}
            </Text>
          ) : null}
        </View>
      ) : null}

      {current.canRefresh ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Refresh connection'
          onPress={() => {
            void haptics.buttonTap();
            refresh();
            onClose();
          }}
          className='mt-4 flex-row items-center justify-center gap-2 rounded-full bg-spaces-accent active:opacity-80'
          style={{ height: BUTTON_HEIGHT }}
        >
          <RefreshCw size={17} color={onAccent} strokeWidth={2.4} />
          <Text className='text-[16px] font-semibold' style={{ color: onAccent }}>
            Refresh
          </Text>
        </Pressable>
      ) : null}

      <View className='mt-4 rounded-2xl bg-spaces-surface px-4 py-1.5'>
        {CONNECTION_STATE_ORDER.map(name => {
          const entry = CONNECTION_STATE_COPY[name];
          const isCurrent = entry.name === current.name;
          return (
            <View
              key={name}
              accessible
              accessibilityLabel={`${entry.label}: ${entry.meaning}${isCurrent ? ' Current state.' : ''}`}
              className='flex-row items-center gap-3'
              style={{ height: STATE_ROW_HEIGHT }}
            >
              <Dot color={entry.dotColor} />
              <Text
                className={cn(
                  'text-[15px] text-spaces-foreground',
                  isCurrent ? 'font-semibold' : 'font-normal',
                )}
              >
                {entry.label}
              </Text>
              <Text numberOfLines={1} className='flex-1 text-right text-[13px] text-spaces-muted'>
                {entry.brief}
              </Text>
            </View>
          );
        })}
      </View>

      <Pressable
        accessibilityRole='link'
        onPress={() => {
          void haptics.buttonTap();
          onClose();
          router.push({
            pathname: '/(protected)/guide/[guideId]',
            params: { guideId: LIVE_SYNC_GUIDE_ID },
          } as Href);
        }}
        hitSlop={8}
        className='mt-3 items-center py-2 active:opacity-60'
      >
        <Text className='text-[14px] font-medium text-spaces-accent'>How live sync works</Text>
      </Pressable>
    </View>
  );
}
