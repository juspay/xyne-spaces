import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Keyboard, Pressable, Text, useWindowDimensions, View } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardChatScrollView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Paperclip,
  Pencil,
  SquarePen,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { XyneAIStarIcon } from '@/src/components/icons';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { useAuth } from '@/src/contexts/AuthContext';
import { ChatComposerScrollToBottomButton } from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import { ChatRenderProvider } from '@/src/features/chat/v3/theme/ChatRenderProvider';
import { BRIEF_SERIF_FONT } from '@/src/features/morning-brief/components/BriefTitle';
import { useChatRenderTokens } from '@/src/theme/useChatRenderTokens';
import { haptics } from '@/src/utils/haptics';
import { formatTime } from '@/src/utils/timeSelection';

import { DEFAULT_AGENT_SLUG } from '../api/xyneAICatalog';
import type { AttachedContextItem, AttachedFile } from '../api/xyneAIRequest';
import { fetchConversationMessages, type ConversationSummary } from '../api/xyneAIConversations';
import { useXyneAIChat } from '../hooks/useXyneAIChat';
import { useXyneAISelection } from '../hooks/useXyneAISelection';
import { isBranched, turnsFromMessages, type ChatTurn } from '../model/assistantTurn';
import { channelPick } from '../model/contextPicks';
import { firstName, greeting } from '../model/greeting';
import { AssistantReply } from './AssistantReply';
import { ICONS } from './ContextPickerSheet';
import { ConversationHistorySheet } from './ConversationHistorySheet';
import { openAttachment, Thumbnail } from './TurnOutputs';
import { XyneAIComposer, type XyneAIComposerHandle } from './XyneAIComposer';

const COMPOSER_KEYBOARD_GAP = 8;
const COPIED_MS = 1500;
const THUMBNAIL_SIZE = 160;

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

const FileChip = ({ filename }: { filename: string }): ReactElement => {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  return (
    <View className='max-w-full flex-row items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5'>
      <Paperclip size={13} color={muted} />
      <Text numberOfLines={1} className='shrink text-[13px] text-foreground'>
        {filename}
      </Text>
    </View>
  );
};

const Attachment = ({ file }: { file: AttachedFile }): ReactElement =>
  (file.id || file.data) && file.mimeType.startsWith('image/') ? (
    <Pressable
      accessibilityRole='imagebutton'
      accessibilityLabel={file.filename}
      onPress={(): void => openAttachment(file)}
    >
      <Thumbnail attachment={file} size={THUMBNAIL_SIZE} borderRadius={16} />
    </Pressable>
  ) : (
    <FileChip filename={file.filename} />
  );

const ContextPills = ({ items }: { items: AttachedContextItem[] }): ReactElement => {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  return (
    <View className='flex-row flex-wrap justify-end gap-1.5'>
      {items.map(({ type, id, title }) => {
        const Icon = ICONS[type];
        return (
          <View
            key={`${type}:${id}`}
            className='h-6 max-w-[200px] flex-row items-center gap-1 rounded-full border border-border px-2'
          >
            {Icon ? <Icon size={12} color={muted} /> : null}
            <Text numberOfLines={1} className='shrink text-[12px] text-secondary-foreground'>
              {title}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

const IconButton = ({
  label,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={label}
    hitSlop={8}
    disabled={disabled}
    onPress={(): void => {
      void haptics.buttonTap();
      onPress();
    }}
    className={`p-1 active:opacity-60 ${disabled ? 'opacity-40' : ''}`}
  >
    {children}
  </Pressable>
);

const UserBubble = ({
  turn,
  version,
  onSwitchVersion,
  onEdit,
}: {
  turn: ChatTurn;
  version: { index: number; total: number } | undefined;
  onSwitchVersion: (step: 1 | -1) => void;
  /** Absent when this message cannot be rewritten. */
  onEdit: (() => void) | undefined;
}): ReactElement => {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return (): void => clearTimeout(timer);
  }, [copied]);

  const CopyIcon = copied ? Check : Copy;
  return (
    <View className='max-w-[78%] items-end gap-1 self-end'>
      {turn.attachments.map((file, index) => (
        <Attachment key={`${index}:${file.filename}`} file={file} />
      ))}
      <View className='rounded-3xl bg-secondary px-4 py-2.5'>
        <Text selectable className='text-[15px] leading-6 text-foreground'>
          {turn.query}
        </Text>
      </View>
      {turn.context.length > 0 ? <ContextPills items={turn.context} /> : null}
      <View className='flex-row items-center gap-1 px-1'>
        {version ? (
          <>
            <IconButton label='Previous version' onPress={(): void => onSwitchVersion(-1)}>
              <ChevronLeft size={16} color={muted} />
            </IconButton>
            <Text className='text-[12px] text-secondary-foreground'>
              {`${version.index + 1}/${version.total}`}
            </Text>
            <IconButton label='Next version' onPress={(): void => onSwitchVersion(1)}>
              <ChevronRight size={16} color={muted} />
            </IconButton>
          </>
        ) : null}
        <IconButton
          label='Copy message'
          onPress={(): void => {
            void Clipboard.setStringAsync(turn.query);
            setCopied(true);
          }}
        >
          <CopyIcon size={16} color={muted} />
        </IconButton>
        {onEdit ? (
          <IconButton label='Edit message' onPress={onEdit}>
            <Pencil size={16} color={muted} />
          </IconButton>
        ) : null}
        <Text className='text-[11px] text-secondary-foreground'>
          {formatTime(new Date(turn.reply.startedAt))}
        </Text>
      </View>
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
      ? { conversationId, previewText, senderId, attachmentIds: attachmentIds?.split(',') ?? [] }
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
                return (
                  <View
                    key={turn.id}
                    className='gap-6'
                    onLayout={
                      isLatest && isStreaming
                        ? ({ nativeEvent }): void => {
                            blankSpace.value = Math.max(
                              0,
                              viewportHeight.current - nativeEvent.layout.height,
                            );
                          }
                        : undefined
                    }
                  >
                    <UserBubble
                      turn={turn}
                      version={versionOf(turn)}
                      onSwitchVersion={(step): void => switchVersion(turn, step)}
                      onEdit={
                        canBranch && isLatest && !isStreaming && turn.reply.userMessageId
                          ? (): void => startEditing(turn)
                          : undefined
                      }
                    />
                    <AssistantReply
                      turn={turn.reply}
                      isLatest={isLatest}
                      viewerId={user?.user_id ?? ''}
                      conversationId={sessionId}
                      onOpenUrl={(url): void => {
                        void openUrl(url);
                      }}
                      onFlowClose={refresh}
                      onFollowUp={(suggestion): void => composerRef.current?.setText(suggestion)}
                      onRegenerate={regenerate}
                      onPendingAction={(action, approved): Promise<void> =>
                        respondToAction(turn.id, action, approved)
                      }
                    />
                  </View>
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
