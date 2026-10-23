import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from 'react';
import {
  Pressable,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
} from 'react-native';
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Moon, Sun } from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { ChannelScopeType, MessageType, type User } from '@xyne/shared';
import { ScopedTheme, useCSSVariable, useUniwind } from 'uniwind';

import { ChatPaintRowLite } from '@/src/features/chat/v2/components/chat/chat-paint-row-lite';
import { haptics } from '@/src/utils/haptics';
import { useChatRenderTokens as useResolvedChatRenderTokens } from '@/src/theme/useChatRenderTokens';
import {
  ChatRenderProvider,
  type ChatRenderTokens,
} from '@/src/features/chat/v2/components/chat/message-row';
import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import { buildChatPaintRows } from '@/src/features/chat/v2/paint/buildChatPaintRows';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { setSetting } from '@/src/machines/settingsMachine';
import { buildChatBubblePreviewTokens } from '@/src/theme/chatBubblePreviewTokens';
import {
  CHAT_BUBBLE_PICKER_OPTIONS,
  DEFAULT_CHAT_BUBBLE_OPTION,
  type ChatBubbleOption,
} from '@/src/theme/chatBubbleTheme';

const HEADER_HEIGHT = 56;
const PAGE_GAP = 10;
const PREVIEW_SWATCH_SIZE = 54;
const SHEET_SWATCH_SIZE = 62;
const SHEET_SWATCH_TOUCH_SIZE = 86;
const PREVIEW_CHANNEL_ID = 'chat-theme-preview-channel';
const PREVIEW_WORKSPACE_ID = 'chat-theme-preview-workspace';
const CURRENT_USER_ID = 'chat-theme-preview-current-user';
const OTHER_USER_ID = 'chat-theme-preview-other-user';

type PreviewTheme = 'light' | 'dark';

const CURRENT_USER = {
  id: CURRENT_USER_ID,
  name: 'You',
  picture: null,
} as User;

const clampIndex = (value: unknown): number => {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(CHAT_BUBBLE_PICKER_OPTIONS.length - 1, Math.max(0, Math.round(parsed)));
};

const escapeMessageMdValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

const metadataBlock = (
  name: string,
  entries: Record<string, string | number | boolean | null | undefined>,
): string => {
  const lines = [`:::${name}`];

  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${escapeMessageMdValue(String(value))}`);
  }

  lines.push(':::');
  return lines.join('\n');
};

const createLinkPreviewMd = (): string =>
  metadataBlock('link_preview', {
    url: 'https://github.com/juspay/xyne-spaces/pull/1',
    title: 'Pull Request #1',
    description: 'juspay/xyne-spaces',
    siteName: 'GitHub',
  });

const createRepliesMd = (): string =>
  [':::replies', `[${OTHER_USER_ID}:Deepanshu, ${CURRENT_USER_ID}:You]`, ':::'].join('\n');

const createInitialMessageMd = ({
  content,
  conversationId,
  createdAt,
  linkPreviewMd,
  messageId,
  senderId,
}: {
  content: string;
  conversationId: string;
  createdAt: number;
  linkPreviewMd?: string | null;
  messageId: string;
  senderId: string;
}): string => {
  const entries: Record<string, string | number | boolean | null | undefined> = {
    messageId,
    conversationId,
    workspaceId: PREVIEW_WORKSPACE_ID,
    senderId,
    content,
    msgType: MessageType.USER,
    hasAttachment: false,
    edited: false,
    isDeleted: false,
    showInChannel: true,
    createdAt,
    isSent: true,
  };

  entries['link_preview_md'] = linkPreviewMd;

  return metadataBlock('initialMessage', entries);
};

const createParentMessageMd = (createdAt: number): string =>
  metadataBlock('parentMessage', {
    messageId: 'chat-theme-preview-parent-message',
    conversationId: 'chat-theme-preview-parent-conversation',
    senderId: OTHER_USER_ID,
    content: 'okay',
    msgType: MessageType.USER,
    createdAt,
  });

type PreviewConversationInput = Partial<ConversationItem> & {
  conversationId: string;
  createdAt: number;
  createdBy: string;
  initialMessageMd: string;
  parentMessageMd?: string | null;
  repliesMd?: string | null;
  ticketMd?: string | null;
};

const createPreviewConversation = ({
  initialMessageMd,
  parentMessageMd,
  repliesMd,
  ticketMd,
  ...input
}: PreviewConversationInput): ConversationItem =>
  ({
    channelId: PREVIEW_CHANNEL_ID,
    initialMessageAttachments: [],
    replyCount: 0,
    ticketId: null,
    ['parent_message_md']: parentMessageMd ?? null,
    ['replies_md']: repliesMd ?? null,
    ['ticket_md']: ticketMd ?? null,
    ['initial_message_md']: initialMessageMd,
    ...input,
  }) as unknown as ConversationItem;

const PREVIEW_CONVERSATIONS: ConversationItem[] = ((): ConversationItem[] => {
  const baseTime = new Date('2026-07-06T20:40:00+05:30').getTime();
  const linkPreviewMd = createLinkPreviewMd();

  return [
    createPreviewConversation({
      conversationId: 'chat-theme-preview-other-instruction',
      createdAt: baseTime,
      createdBy: OTHER_USER_ID,
      initialMessageMd: createInitialMessageMd({
        messageId: 'chat-theme-preview-other-instruction-message',
        conversationId: 'chat-theme-preview-other-instruction',
        senderId: OTHER_USER_ID,
        content: 'Swipe left or right to preview more chat bubbles.',
        createdAt: baseTime,
      }),
    }),
    createPreviewConversation({
      conversationId: 'chat-theme-preview-current-link',
      createdAt: baseTime + 60_000,
      createdBy: CURRENT_USER_ID,
      initialMessageMd: createInitialMessageMd({
        messageId: 'chat-theme-preview-current-link-message',
        conversationId: 'chat-theme-preview-current-link',
        senderId: CURRENT_USER_ID,
        content: 'https://github.com/juspay/xyne-spaces/pull/1',
        createdAt: baseTime + 60_000,
        linkPreviewMd,
      }),
    }),
    createPreviewConversation({
      conversationId: 'chat-theme-preview-current-thread',
      createdAt: baseTime + 120_000,
      createdBy: CURRENT_USER_ID,
      parentMessageMd: createParentMessageMd(baseTime - 60_000),
      initialMessageMd: createInitialMessageMd({
        messageId: 'chat-theme-preview-current-thread-message',
        conversationId: 'chat-theme-preview-current-thread',
        senderId: CURRENT_USER_ID,
        content: 'Hello',
        createdAt: baseTime + 120_000,
      }),
    }),
    createPreviewConversation({
      conversationId: 'chat-theme-preview-current-replies',
      createdAt: baseTime + 180_000,
      createdBy: CURRENT_USER_ID,
      repliesMd: createRepliesMd(),
      replyCount: 4,
      initialMessageMd: createInitialMessageMd({
        messageId: 'chat-theme-preview-current-replies-message',
        conversationId: 'chat-theme-preview-current-replies',
        senderId: CURRENT_USER_ID,
        content: 'Can this be done for our chat bubble?',
        createdAt: baseTime + 180_000,
      }),
    }),
  ];
})();

// The mock conversations are module constants, so the paint rows are identical for every page.
// Built lazily rather than at module scope so importing this route does not run the paint
// builder during bundle evaluation.
let previewRowsCache: ChatPaintRow[] | null = null;

const getPreviewRows = (): ChatPaintRow[] =>
  (previewRowsCache ??= buildChatPaintRows({
    channelId: PREVIEW_CHANNEL_ID,
    channelType: ChannelScopeType.DM,
    conversations: PREVIEW_CONVERSATIONS,
    currentUser: CURRENT_USER,
  }));

type PreviewColors = {
  bg: string;
  label: string;
  rowDivider: string;
  sheetBg: string;
};

const usePreviewColors = (): PreviewColors => ({
  bg: useCSSVariable('--color-settings-bg') as string,
  label: useCSSVariable('--color-settings-label') as string,
  rowDivider: useCSSVariable('--color-settings-row-divider') as string,
  sheetBg: useCSSVariable('--color-settings-section-bg') as string,
});

type PreviewPageProps = {
  height: number;
  tokens: ChatRenderTokens;
  width: number;
};

// Hook-free and memoized: every prop is referentially stable across snaps, so scrolling the
// pager does not re-render already-mounted pages.
const PreviewPage = memo(function PreviewPage({
  height,
  tokens,
  width,
}: PreviewPageProps): ReactElement {
  const rows = getPreviewRows();

  return (
    <View className='overflow-hidden' style={{ height, width }}>
      {/* Matches the real chat thread surface (chat-thread.tsx uses `bg-chat-screen`). */}
      <View className='flex-1 bg-chat-screen'>
        <ChatRenderProvider value={tokens}>
          <View pointerEvents='none' className='flex-1 px-1 pt-4'>
            <View className='mb-2 self-center rounded-lg bg-black/35 px-3 py-1.5'>
              <Text className='text-sm font-medium text-white'>Today</Text>
            </View>

            {rows.map(row => (
              <View key={row.rowId} className='px-3'>
                <ChatPaintRowLite row={row} channelType={ChannelScopeType.DM} hydrateInlineEmoji />
              </View>
            ))}
          </View>
        </ChatRenderProvider>
      </View>
    </View>
  );
});

type ChatRenderTokensProbeProps = {
  onResolve: (tokens: ChatRenderTokens) => void;
  width: number;
};

/**
 * Renders nothing. Exists only to re-read CSS variables under the current `ScopedTheme`.
 *
 * uniwind's `useCSSVariable` re-subscribes when the uniwind context changes but never re-reads
 * the value, so a `ScopedTheme` flip leaves resolved colors stale. Remounting *this* (via a
 * `key`) gets fresh values without tearing down the pager and every mounted preview page.
 */
const ChatRenderTokensProbe = ({ onResolve, width }: ChatRenderTokensProbeProps): null => {
  const tokens = useResolvedChatRenderTokens(width);

  useEffect(() => {
    onResolve(tokens);
  }, [onResolve, tokens]);

  return null;
};

type ChatBubbleThemeToggleButtonProps = {
  onPress: () => void;
  previewTheme: PreviewTheme;
};

const ChatBubbleThemeToggleButton = ({
  onPress,
  previewTheme,
}: ChatBubbleThemeToggleButtonProps): ReactElement => {
  const nextTheme = previewTheme === 'light' ? 'dark' : 'light';
  const Icon = previewTheme === 'light' ? Moon : Sun;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Preview in ${nextTheme} mode`}
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      className='absolute bottom-5 right-5 h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-white/90 active:opacity-75'
    >
      <Icon size={22} color='#111827' strokeWidth={2.25} />
    </Pressable>
  );
};

type ChatBubblePreviewBodyProps = {
  baseTokens: ChatRenderTokens;
  colors: PreviewColors;
  initialIndex: number;
  onTogglePreviewTheme: () => void;
  pageHeight: number;
  previewTheme: PreviewTheme;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  width: number;
};

const ChatBubblePreviewBody = ({
  baseTokens,
  colors,
  initialIndex,
  onTogglePreviewTheme,
  pageHeight,
  previewTheme,
  selectedIndex,
  setSelectedIndex,
  width,
}: ChatBubblePreviewBodyProps): ReactElement => {
  const listRef = useRef<LegendListRef>(null);
  const colorSheetRef = useRef<BottomSheetModal>(null);
  const pageWidth = width;
  const snapInterval = pageWidth + PAGE_GAP;
  const colorSheetSnapPoints = useMemo(() => [Math.round(pageHeight * 0.5)], [pageHeight]);

  // The CSS bubble variables are byte-identical to these literals, so reading them back through
  // `useCSSVariable` would only add a 38-key subscription (and a `ScopedTheme` staleness hazard).
  const pageColors = useMemo(
    () =>
      CHAT_BUBBLE_PICKER_OPTIONS.map(option =>
        previewTheme === 'dark' ? option.darkColor : option.lightColor,
      ),
    [previewTheme],
  );
  const previewColor = pageColors[selectedIndex] ?? DEFAULT_CHAT_BUBBLE_OPTION.lightColor;

  // All 19 token sets up front. Cheap (object spreads over cached color math) and it keeps
  // `PreviewPage` free of hooks and stable across snaps.
  const pageTokens = useMemo(
    () => pageColors.map(color => buildChatBubblePreviewTokens(baseTokens, color, previewTheme)),
    [baseTokens, pageColors, previewTheme],
  );

  const handleSnap = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      setSelectedIndex(clampIndex(Math.round(event.nativeEvent.contentOffset.x / snapInterval)));
    },
    [setSelectedIndex, snapInterval],
  );
  const openColorSheet = useCallback((): void => {
    colorSheetRef.current?.present();
  }, []);
  const renderColorSheetBackdrop = useCallback(
    (props: BottomSheetBackdropProps): ReactElement => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.45}
        pressBehavior='close'
      />
    ),
    [],
  );
  const handleSheetColorPress = useCallback(
    (index: number): void => {
      setSelectedIndex(index);
      void listRef.current?.scrollToOffset({
        offset: index * snapInterval,
        animated: false,
      });
    },
    [setSelectedIndex, snapInterval],
  );

  const getFixedItemSize = useCallback(() => snapInterval, [snapInterval]);
  // Deliberately independent of `selectedIndex`: snapping must not invalidate mounted pages.
  const listExtraData = useMemo(
    () => ({ pageHeight, pageTokens, pageWidth, snapInterval }),
    [pageHeight, pageTokens, pageWidth, snapInterval],
  );
  const renderItem = useCallback(
    ({ index }: LegendListRenderItemProps<ChatBubbleOption>): ReactElement => (
      <View style={{ width: snapInterval, paddingRight: PAGE_GAP }}>
        <PreviewPage
          height={pageHeight}
          tokens={pageTokens[index] ?? baseTokens}
          width={pageWidth}
        />
      </View>
    ),
    [baseTokens, pageHeight, pageTokens, pageWidth, snapInterval],
  );

  return (
    <>
      <View className='flex-1'>
        <LegendList
          ref={listRef}
          data={CHAT_BUBBLE_PICKER_OPTIONS}
          horizontal
          keyExtractor={item => item.varName}
          estimatedItemSize={snapInterval}
          estimatedListSize={{ height: pageHeight, width }}
          extraData={listExtraData}
          getFixedItemSize={getFixedItemSize}
          initialScrollIndex={initialIndex}
          recycleItems
          // Default is 250px, i.e. less than one page, which mounts the incoming page mid-swipe.
          // One page of look-ahead moves that work to just after the previous snap settles.
          drawDistance={pageWidth}
          decelerationRate='fast'
          disableIntervalMomentum
          snapToAlignment='start'
          snapToInterval={snapInterval}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          onMomentumScrollEnd={handleSnap}
          renderItem={renderItem}
        />
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Choose chat bubble color'
          onPress={openColorSheet}
          onPressIn={(): void => {
            void haptics.buttonTap();
          }}
          className='absolute bottom-4 left-5 items-center justify-center rounded-full border-2 bg-black/10 active:opacity-75'
          style={{
            width: PREVIEW_SWATCH_SIZE,
            height: PREVIEW_SWATCH_SIZE,
            borderColor: colors.rowDivider,
          }}
        >
          <View
            className='rounded-full'
            style={{
              width: PREVIEW_SWATCH_SIZE - 8,
              height: PREVIEW_SWATCH_SIZE - 8,
              backgroundColor: previewColor,
            }}
          />
        </Pressable>
        <ChatBubbleThemeToggleButton onPress={onTogglePreviewTheme} previewTheme={previewTheme} />
      </View>

      <BottomSheetModal
        ref={colorSheetRef}
        index={0}
        snapPoints={colorSheetSnapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        backdropComponent={renderColorSheetBackdrop}
        handleStyle={{ paddingBottom: 8, paddingTop: 12 }}
        handleIndicatorStyle={{
          width: 56,
          height: 5,
          borderRadius: 999,
          backgroundColor: '#aeb4bd',
        }}
        backgroundStyle={{
          backgroundColor: colors.sheetBg,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
        }}
      >
        <BottomSheetScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps='handled'
          contentContainerStyle={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 34,
          }}
        >
          {CHAT_BUBBLE_PICKER_OPTIONS.map((option, index) => {
            const swatchColor = pageColors[index] ?? option.lightColor;
            const isSelected = index === selectedIndex;

            return (
              <Pressable
                key={option.varName}
                accessibilityRole='button'
                accessibilityLabel={`Preview chat bubble color ${option.index + 1}`}
                onPress={() => handleSheetColorPress(index)}
                className='items-center justify-center'
                style={{ height: SHEET_SWATCH_TOUCH_SIZE, width: '25%' }}
              >
                <View
                  className='items-center justify-center rounded-full'
                  style={{
                    width: SHEET_SWATCH_SIZE + 12,
                    height: SHEET_SWATCH_SIZE + 12,
                    borderWidth: isSelected ? 2 : 0,
                    borderColor: colors.label,
                  }}
                >
                  <View
                    className='rounded-full'
                    style={{
                      width: SHEET_SWATCH_SIZE,
                      height: SHEET_SWATCH_SIZE,
                      backgroundColor: swatchColor,
                    }}
                  />
                  {isSelected ? (
                    <View className='absolute h-8 w-8 items-center justify-center rounded-full bg-white'>
                      <Check size={20} color='#111827' strokeWidth={3} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheetModal>
    </>
  );
};

export default function ChatBubblePreviewScreen(): ReactElement {
  const router = useRouter();
  const colors = usePreviewColors();
  const { theme } = useUniwind();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ initialIndex?: string }>();
  const initialIndex = useMemo(() => clampIndex(params.initialIndex), [params.initialIndex]);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>(
    theme === 'light' ? 'light' : 'dark',
  );

  // `SafeAreaView` uses top+bottom edges, so deriving the page height from insets rather than
  // waiting on `onLayout` avoids building every page twice on open.
  const pageHeight = Math.max(1, height - insets.top - insets.bottom - HEADER_HEIGHT);

  // The preview opens in the app's own theme, so the app-level tokens are a correct seed. The
  // probe then keeps them in sync as `previewTheme` is toggled.
  const appTokens = useResolvedChatRenderTokens(width);
  const [baseTokens, setBaseTokens] = useState<ChatRenderTokens>(appTokens);

  const activeOption = CHAT_BUBBLE_PICKER_OPTIONS[selectedIndex] ?? DEFAULT_CHAT_BUBBLE_OPTION;

  const handleTogglePreviewTheme = useCallback((): void => {
    setPreviewTheme(current => (current === 'light' ? 'dark' : 'light'));
  }, []);

  const handleSelect = (): void => {
    setSetting('chatTheme.bubbleColorVar', activeOption.varName);
    router.back();
  };

  return (
    <SafeAreaView className='bg-settings-bg' style={{ flex: 1 }} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />
      <View className='min-h-14 flex-row items-center gap-2 border-b border-settings-row-divider bg-settings-section-bg px-2'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={colors.label} />
        <Text className='flex-1 text-[20px] font-medium leading-8 text-settings-label'>
          Preview
        </Text>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Select chat bubble color'
          onPress={handleSelect}
          className='h-[38px] w-[38px] items-center justify-center rounded-full bg-action-primary active:opacity-75'
        >
          <Check size={24} color='#ffffff' strokeWidth={3} />
        </Pressable>
      </View>

      <ScopedTheme theme={previewTheme}>
        <ChatRenderTokensProbe key={previewTheme} onResolve={setBaseTokens} width={width} />
        <ChatBubblePreviewBody
          baseTokens={baseTokens}
          colors={colors}
          initialIndex={initialIndex}
          onTogglePreviewTheme={handleTogglePreviewTheme}
          pageHeight={pageHeight}
          previewTheme={previewTheme}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          width={width}
        />
      </ScopedTheme>
    </SafeAreaView>
  );
}
