import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Keyboard, Pressable, Text, useWindowDimensions, View } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardChatScrollView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, History, SquarePen } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { XyneAIStarIcon } from '@/src/components/icons';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { useAuth } from '@/src/contexts/AuthContext';
import { ChatComposerScrollToBottomButton } from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import { ChatRenderProvider } from '@/src/features/chat/v3/theme/ChatRenderProvider';
import { BRIEF_SERIF_FONT } from '@/src/features/morning-brief/components/BriefTitle';
import { useChatRenderTokens } from '@/src/theme/useChatRenderTokens';

import { DEFAULT_AGENT_SLUG } from '../api/xyneAICatalog';
import type { PendingAction } from '../api/xyneAIEvents';
import { fetchConversationMessages, type ConversationSummary } from '../api/xyneAIConversations';
import { useXyneAIChat } from '../hooks/useXyneAIChat';
import { useXyneAISelection } from '../hooks/useXyneAISelection';
import { useStableCallback } from '../hooks/useStableCallback';
import { isBranched, turnsFromMessages, type ChatTurn } from '../model/assistantTurn';
import { channelPick } from '../model/contextPicks';
import { firstName, greeting } from '../model/greeting';
import { ConversationHistorySheet } from './ConversationHistorySheet';
import { IconButton } from './IconButton';
import { TurnRow } from './TurnRow';
import { XyneAIComposer, type XyneAIComposerHandle } from './XyneAIComposer';

const COMPOSER_KEYBOARD_GAP = 8;

/** The chat last open on this screen, kept in memory so coming back resumes it. */
let rememberedChat: { userId: string; conversationId: string; agentSlug: string } | undefined;

/** Route params from "Ask AI" on a message, thread or channel: what this chat is about. */
type AskAIParams = Partial<
  Record<
    'conversationId' | 'previewText' | 'senderId' | 'attachmentIds' | 'channelId' | 'channelName',
    string
  >
>;

const Greeting = (): ReactElement => {
  const { user } = useAuth();
  const text = useMemo(
    () => greeting(new Date(), firstName(user?.name, user?.email)),
    [user?.name, user?.email],
  );
  return (
    <View className='items-center gap-3'>
      <XyneAIStarIcon size={36} />
      <Text
        accessibilityRole='header'
        className='text-center text-foreground'
        style={{ fontFamily: BRIEF_SERIF_FONT, fontSize: 24, lineHeight: 32 }}
      >
        {text}
      </Text>
    </View>
  );
};

export const XyneAIScreen = (): ReactElement => {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const renderTokens = useChatRenderTokens(width);
  const openUrl = useMentionPress();
  const selection = useXyneAISelection();
  // "Ask AI" on a message pushes a new screen, so each ask starts from its own params.
  const {
    conversationId,
    previewText = '',
    senderId,
    attachmentIds,
    channelId,
    channelName = '',
  } = useLocalSearchParams<AskAIParams>();
  const [channel, setChannel] = useState(() =>
    channelId ? channelPick(channelId, channelName) : undefined,
  );
  const [thread, setThread] = useState(() =>
    conversationId
      ? {
          conversationId,
          previewText: previewText.trim() || 'Message',
          senderId,
          attachmentIds: attachmentIds?.split(',') ?? [],
        }
      : undefined,
  );
  const requestOptions = useMemo(
    () => ({
      ...selection.requestOptions,
      attachedContext: channel && [channel],
      conversationId: thread?.conversationId,
      messageAttachmentIds: thread?.attachmentIds,
    }),
    [selection.requestOptions, channel, thread],
  );
  const {
    turns,
    isStreaming,
    canBranch,
    sessionId,
    send,
    open,
    refresh,
    forget,
    regenerate,
    respondToAction,
    edit,
    versionOf,
    switchVersion,
    stop,
    reset,
  } = useXyneAIChat(requestOptions);
  const foreground = useCSSVariable('--color-foreground') as string;
  const composerRef = useRef<XyneAIComposerHandle>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // Plain opens resume the remembered chat; "Ask AI" opens start fresh with their scope.
  const [isRestoring, setIsRestoring] = useState(
    () => !conversationId && !channelId && !!user && rememberedChat?.userId === user.user_id,
  );
  // The turn itself, so an edit still targets it if it leaves the visible path.
  const [editing, setEditing] = useState<ChatTurn>();

  const [isAtEnd, setIsAtEnd] = useState(true);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const bottomGap = Math.max(insets.bottom, COMPOSER_KEYBOARD_GAP);
  const scrollRef = useRef<Reanimated.ScrollView>(null);
  const viewportHeight = useRef(0);
  const composerHeight = useSharedValue(0);
  const greetingStyle = useAnimatedStyle(() => ({ paddingBottom: composerHeight.value }));
  // Room under the newest question so it sits at the top while its answer streams in.
  const blankSpace = useSharedValue(0);

  // Set before turns change; applied once the new content is laid out.
  const pendingScroll = useRef<'animated' | 'instant' | null>(null);

  const scrollToEnd = (): void => scrollRef.current?.scrollToEnd({ animated: true });

  const submit: typeof send = (...message) => {
    pendingScroll.current = 'animated';
    if (editing) edit(editing, ...message);
    else send(...message);
    setEditing(undefined);
  };

  const startEditing = (turn: ChatTurn): void => {
    setEditing(turn);
    composerRef.current?.setText(turn.query);
  };

  const onLatestLayout = useStableCallback((height: number): void => {
    blankSpace.value = Math.max(0, viewportHeight.current - height);
  });
  const onSwitchVersion = useStableCallback(switchVersion);
  const onEdit = useStableCallback(startEditing);
  const onOpenUrl = useStableCallback((url: string): void => {
    void openUrl(url);
  });
  const onFlowClose = useStableCallback(refresh);
  const onFollowUp = useStableCallback((suggestion: string): void =>
    composerRef.current?.setText(suggestion),
  );
  const onRegenerate = useStableCallback(regenerate);
  const onPendingAction = useStableCallback(
    (turn: ChatTurn, action: PendingAction, approved: boolean): Promise<void> =>
      respondToAction(turn.id, action, approved),
  );

  const cancelEditing = (): void => {
    setEditing(undefined);
    composerRef.current?.setText('');
  };
  const leaveChat = (): void => {
    if (editing) cancelEditing();
  };

  const showConversation = (
    conversation: Pick<ConversationSummary, 'conversationId' | 'agentSlug'>,
  ): Promise<void> =>
    fetchConversationMessages(conversation).then(stored => {
      selection.selectAgent(
        conversation.agentSlug === DEFAULT_AGENT_SLUG ? undefined : conversation.agentSlug,
      );
      setChannel(undefined);
      setThread(undefined);
      leaveChat();
      blankSpace.value = 0;
      pendingScroll.current = 'instant';
      open(turnsFromMessages(stored), conversation.conversationId, isBranched(stored));
    });

  const openConversation = (conversation: ConversationSummary): void => {
    setIsHistoryOpen(false);
    showConversation(conversation).catch(() =>
      Alert.alert('Could not open this chat', 'Please try again.'),
    );
  };

  const deleted = (conversationId: string): void => {
    if (rememberedChat?.conversationId === conversationId) rememberedChat = undefined;
    forget(conversationId);
  };

  useEffect(() => {
    if (!isRestoring || !rememberedChat) return;
    showConversation(rememberedChat)
      .catch(() => {
        rememberedChat = undefined;
      })
      .finally(() => setIsRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restores once, on mount
  }, []);

  const { agentSlug } = selection;
  useEffect(() => {
    if (sessionId && user) {
      rememberedChat = {
        userId: user.user_id,
        conversationId: sessionId,
        agentSlug: agentSlug ?? DEFAULT_AGENT_SLUG,
      };
    }
  }, [sessionId, user, agentSlug]);

  const startNewChat = (): void => {
    rememberedChat = undefined;
    setChannel(undefined);
    setThread(undefined);
    leaveChat();
    reset();
  };

  const selectAgent = (slug: string | undefined): void => {
    if (slug === selection.agentSlug) return;
    selection.selectAgent(slug);
    reset();
  };

  return (
    <SafeAreaView className='flex-1 bg-chat-screen' edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className='min-h-14 flex-row items-center gap-4 px-4'>
        <IconButton label='Back' onPress={(): void => router.back()}>
          <ChevronLeft size={26} color={foreground} />
        </IconButton>
        <Text
          accessibilityRole='header'
          className='flex-1 text-[17px] font-semibold text-foreground'
        >
          Xyne AI
        </Text>
        <IconButton label='History' onPress={(): void => setIsHistoryOpen(true)}>
          <History size={22} color={foreground} />
        </IconButton>
        <IconButton label='New chat' disabled={turns.length === 0} onPress={startNewChat}>
          <SquarePen size={22} color={foreground} />
        </IconButton>
      </View>

      <View className='flex-1'>
        {isRestoring ? null : turns.length === 0 ? (
          <KeyboardAvoidingView behavior='padding' className='flex-1'>
            <Reanimated.View className='flex-1' style={greetingStyle}>
              <Pressable
                accessible={false}
                onPress={Keyboard.dismiss}
                className='flex-1 justify-center px-4'
              >
                <Greeting />
              </Pressable>
            </Reanimated.View>
          </KeyboardAvoidingView>
        ) : (
          <ChatRenderProvider value={renderTokens}>
            <KeyboardChatScrollView
              ref={scrollRef}
              keyboardLiftBehavior='whenAtEnd'
              // iOS: without it the blank space under the newest turn does not take scroll gestures.
              applyWorkaroundForContentInsetHitTestBug
              offset={insets.bottom}
              extraContentPadding={composerHeight}
              blankSpace={blankSpace}
              freeze={isSheetOpen || isHistoryOpen}
              onEndVisible={setIsAtEnd}
              onContentSizeChange={(): void => {
                if (!pendingScroll.current) return;
                scrollRef.current?.scrollToEnd({ animated: pendingScroll.current === 'animated' });
                pendingScroll.current = null;
              }}
              onLayout={({ nativeEvent }): void => {
                viewportHeight.current = nativeEvent.layout.height;
              }}
              contentContainerClassName='gap-6 p-4'
              keyboardDismissMode='interactive'
              keyboardShouldPersistTaps='handled'
            >
              {turns.map((turn, index) => {
                const isLatest = index === turns.length - 1;
                const version = versionOf(turn);
                return (
                  <TurnRow
                    key={turn.id}
                    turn={turn}
                    isLatest={isLatest}
                    isStreaming={isLatest && isStreaming}
                    canEdit={canBranch && isLatest && !isStreaming && !!turn.reply.userMessageId}
                    versionIndex={version?.index}
                    versionTotal={version?.total}
                    viewerId={user?.user_id ?? ''}
                    conversationId={sessionId}
                    onLatestLayout={onLatestLayout}
                    onSwitchVersion={onSwitchVersion}
                    onEdit={onEdit}
                    onOpenUrl={onOpenUrl}
                    onFlowClose={onFlowClose}
                    onFollowUp={onFollowUp}
                    onRegenerate={onRegenerate}
                    onPendingAction={onPendingAction}
                  />
                );
              })}
            </KeyboardChatScrollView>
            <ChatComposerScrollToBottomButton
              composerHeight={composerHeight}
              enabled
              visible={!isAtEnd}
              onPress={scrollToEnd}
            />
          </ChatRenderProvider>
        )}
        <KeyboardStickyView
          offset={{ closed: 0, opened: bottomGap - COMPOSER_KEYBOARD_GAP }}
          className='absolute inset-x-0 bottom-0'
        >
          <View
            className='px-4 pt-2'
            style={{ paddingBottom: bottomGap }}
            onLayout={({ nativeEvent }): void => {
              composerHeight.value = nativeEvent.layout.height;
            }}
          >
            <XyneAIComposer
              ref={composerRef}
              isStreaming={isStreaming}
              onSubmit={submit}
              onStop={stop}
              selection={selection}
              onSelectAgent={selectAgent}
              onSheetChange={setIsSheetOpen}
              editing={editing && { onCancel: cancelEditing }}
              channel={
                channel && { label: channel.title, onRemove: (): void => setChannel(undefined) }
              }
              thread={
                thread && {
                  label: thread.previewText,
                  senderId: thread.senderId,
                  onRemove: (): void => setThread(undefined),
                }
              }
            />
          </View>
        </KeyboardStickyView>
      </View>
      <ConversationHistorySheet
        isOpen={isHistoryOpen}
        onClose={(): void => setIsHistoryOpen(false)}
        onOpenConversation={openConversation}
        onDeleted={deleted}
        runningConversationId={isStreaming ? sessionId : undefined}
      />
    </SafeAreaView>
  );
};
