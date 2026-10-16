import { Fragment, useCallback, useRef, type ComponentType, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bookmark,
  CircleAlert,
  FileText,
  LifeBuoy,
  MessagesSquare,
  Mic,
  Presentation,
  Sunrise,
  type LucideProps,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { ListRowDivider } from '@/src/components/ui/settings-list';
import { useRegisterTabScrollToTop } from '@/src/hooks/useRegisterTabScrollToTop';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';
import { haptics } from '@/src/utils/haptics';

type MoreRowProps = {
  icon: ComponentType<LucideProps>;
  label: string;
  description: string;
  onPress: () => void;
};

/**
 * Full-bleed row: no side inset, no chevron, and a divider that runs edge to edge.
 * Colors come from the `--color-settings-*` tokens so the row is theme-correct in
 * light and dark. The minimum height still clears the 44pt tap target.
 */
function MoreRow({ icon: Icon, label, description, onPress }: MoreRowProps): ReactElement {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;

  return (
    <Pressable
      onPress={(): void => {
        void haptics.buttonTap();
        onPress();
      }}
      accessibilityRole='button'
      accessibilityLabel={label}
      android_ripple={{ color: dividerColor }}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      <View className='min-h-[72px] flex-row items-center gap-4 px-5 py-3'>
        <View className='w-7 shrink-0 items-center'>
          <Icon size={22} color={labelColor} strokeWidth={1.8} />
        </View>
        <View className='min-w-0 flex-1'>
          <Text className='text-[17px]' style={{ color: labelColor }} numberOfLines={1}>
            {label}
          </Text>
          <Text
            className='mt-0.5 text-[14px]'
            style={{ color: descriptionColor }}
            numberOfLines={1}
          >
            {description}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

type MoreRowDefinition = {
  id: string;
  icon: ComponentType<LucideProps>;
  label: string;
  description: string;
  navigate: (router: ReturnType<typeof useRouter>) => void;
};

/**
 * Every secondary destination, in the order they should appear. Threads,
 * Recordings, Bookmarks and Canvas used to be shortcut cards on the Channels
 * screen; the `(shortcuts)` group sits outside `(tabs)`, so pushing one of
 * these hides the tab bar and the target screen draws its own back button.
 */
const MORE_ROWS: readonly MoreRowDefinition[] = [
  {
    id: 'morning-brief',
    icon: Sunrise,
    label: 'Morning Brief',
    description: 'Your day, summarized each morning',
    navigate: router => router.push('/(protected)/morning-brief'),
  },
  {
    id: 'threads',
    icon: MessagesSquare,
    label: 'Threads',
    description: 'Catch up on thread replies',
    navigate: router => router.push('/(protected)/(shortcuts)/threads'),
  },
  {
    id: 'recordings',
    icon: Mic,
    label: 'Recordings',
    description: 'Meeting and call recordings',
    navigate: router => router.push('/(protected)/(shortcuts)/recordings'),
  },
  {
    id: 'bookmarks',
    icon: Bookmark,
    label: 'Bookmarks',
    description: 'Messages you saved for later',
    navigate: router => router.push('/(protected)/(shortcuts)/bookmarks'),
  },
  {
    id: 'drafts-sent',
    icon: FileText,
    label: 'Drafts & Sent',
    description: 'Drafts, scheduled, and sent messages',
    navigate: router => router.push('/(protected)/(shortcuts)/drafts-sent'),
  },
  {
    id: 'canvas',
    icon: Presentation,
    label: 'Canvas',
    description: 'Docs and canvases in your workspace',
    navigate: router => router.push('/(protected)/(shortcuts)/canvas'),
  },
  {
    id: 'xyne-desks',
    icon: LifeBuoy,
    label: 'Xyne Desks',
    description: 'Browse your desks and tickets',
    navigate: router => router.push('/xyne-desks'),
  },
  {
    id: 'report-issue',
    icon: CircleAlert,
    label: 'Report issue',
    description: 'Tell us what went wrong',
    navigate: router => router.push('/report-issue'),
  },
];

export default function MoreScreen(): ReactElement {
  const router = useRouter();
  useReportTabReady('more', true);
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const scrollRef = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);
  useRegisterTabScrollToTop('more', scrollToTop);

  return (
    <View className='flex-1 bg-tabs-screen'>
      {/* The shared tab header is absolutely positioned, so the list pads itself down. */}
      <ScrollView
        ref={scrollRef}
        className='flex-1'
        contentContainerStyle={{
          paddingTop: topSafeHeight + headerHeight,
          paddingBottom: 100,
        }}
        showsVerticalScrollIndicator={false}
      >
        {MORE_ROWS.map(row => (
          <Fragment key={row.id}>
            <MoreRow
              icon={row.icon}
              label={row.label}
              description={row.description}
              onPress={() => row.navigate(router)}
            />
            <ListRowDivider inset={0} />
          </Fragment>
        ))}
      </ScrollView>
    </View>
  );
}
