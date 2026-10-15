import { useMemo, useRef, useState, type ReactElement } from 'react';
import { Stack, useRouter } from 'expo-router';
import {
  Alert,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { History, SquarePen } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { HeaderBackButton, HeaderIconButton } from '@/src/components/ui/header-icon-button';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { useAuth } from '@/src/contexts/AuthContext';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import {
  CHAT_COMPOSER_SURFACE_TOP_PADDING,
  getChatComposerBottomPadding,
} from '@/src/features/chat/v3/composer/chatKeyboardConfig';
import { ChatRenderProvider } from '@/src/features/chat/v3/theme/ChatRenderProvider';
import { BRIEF_SERIF_FONT } from '@/src/features/morning-brief/components/BriefTitle';
import { useChatRenderTokens } from '@/src/theme/useChatRenderTokens';
import { formatTime } from '@/src/utils/timeSelection';

import { DEFAULT_AGENT_SLUG } from '../api/xyneAICatalog';
import type { AttachedContextItem } from '../api/xyneAIRequest';
import { fetchConversationMessages, type ConversationSummary } from '../api/xyneAIConversations';
import { useXyneAIChat } from '../hooks/useXyneAIChat';
import { useXyneAISelection } from '../hooks/useXyneAISelection';
import { turnsFromMessages } from '../model/assistantTurn';
import { firstName, greeting } from '../model/greeting';
import { AssistantReply } from './AssistantReply';
import { ConversationHistorySheet } from './ConversationHistorySheet';
import { XyneAIComposer } from './XyneAIComposer';

const NEAR_BOTTOM_PX = 120;

const Greeting = (): ReactElement => {
  const { user } = useAuth();
  const text = useMemo(
    () => greeting(new Date(), firstName(user?.name, user?.email)),
    [user?.name, user?.email],
  );
  return (
    <Text
      accessibilityRole='header'
      className='text-center text-foreground'
      style={{ fontFamily: BRIEF_SERIF_FONT, fontSize: 24, lineHeight: 32 }}
    >
      {text}
    </Text>
  );
};

const UserBubble = ({ query, sentAt }: { query: string; sentAt: number }): ReactElement => (
  <View className='max-w-[78%] items-end gap-1 self-end'>
    <View className='rounded-3xl bg-secondary px-4 py-2.5'>
      <Text selectable className='text-[15px] leading-6 text-foreground'>
        {query}
      </Text>
    </View>
    <Text className='px-1 text-[11px] text-secondary-foreground'>
      {formatTime(new Date(sentAt))}
    </Text>
  </View>
);

const ComposerDock = ({ children }: { children: ReactElement }): ReactElement => {
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardState(state => state.isVisible);
  return (
    <View
      className='bg-conversation-input-surface px-4'
      style={{
        paddingTop: CHAT_COMPOSER_SURFACE_TOP_PADDING,
        paddingBottom: getChatComposerBottomPadding(insets.bottom, !isKeyboardVisible),
      }}
    >
      {children}
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
  const { turns, isStreaming, send, open, forget, regenerate, stop, reset } = useXyneAIChat(
    selection.requestOptions,
  );
  const foreground = useCSSVariable('--color-foreground') as string;
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState<AttachedContextItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const isNearBottom = useRef(true);

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    isNearBottom.current =
      contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_BOTTOM_PX;
  };

  const submit = (): void => {
    isNearBottom.current = true;
    send(draft, context);
    setDraft('');
    setContext([]);
  };

  const openConversation = (conversation: ConversationSummary): void => {
    setIsHistoryOpen(false);
    fetchConversationMessages(conversation)
      .then(stored => {
        selection.selectAgent(
          conversation.agentSlug === DEFAULT_AGENT_SLUG ? undefined : conversation.agentSlug,
        );
        open(turnsFromMessages(stored), conversation.conversationId);
      })
      .catch(() => Alert.alert('Could not open this chat', 'Please try again.'));
  };

  const selectAgent = (slug: string | undefined): void => {
    if (slug === selection.agentSlug) return;
    selection.selectAgent(slug);
    reset();
  };

  return (
    <SafeAreaView className='flex-1 bg-chat-screen' edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className='min-h-14 flex-row items-center gap-3 px-2'>
        <HeaderBackButton liquidGlass onPress={(): void => router.back()} />
        <Text
          className='min-w-0 flex-1 text-[15px] font-semibold text-foreground'
          numberOfLines={1}
        >
          Xyne AI
        </Text>
        <HeaderIconButton
          liquidGlass
          accessibilityLabel='History'
          onPress={(): void => setIsHistoryOpen(true)}
        >
          <History size={20} color={foreground} />
        </HeaderIconButton>
        <HeaderIconButton
          liquidGlass
          accessibilityLabel='New chat'
          disabled={turns.length === 0}
          onPress={reset}
        >
          <SquarePen size={20} color={foreground} />
        </HeaderIconButton>
      </View>

      <KeyboardAvoidingView behavior='padding' className='flex-1'>
        {turns.length === 0 ? (
          <View className='flex-1 justify-center px-4'>
            <Greeting />
          </View>
        ) : (
          <ChatRenderProvider value={renderTokens}>
            <ScrollView
              ref={scrollRef}
              className='flex-1'
              contentContainerClassName='gap-6 p-4'
              keyboardDismissMode='on-drag'
              keyboardShouldPersistTaps='handled'
              scrollEventThrottle={16}
              onScroll={onScroll}
              onContentSizeChange={(): void => {
                if (isNearBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
              }}
            >
              {turns.map((turn, index) => (
                <View key={turn.id} className='gap-6'>
                  <UserBubble query={turn.query} sentAt={turn.reply.startedAt} />
                  <AssistantReply
                    turn={turn.reply}
                    isLatest={index === turns.length - 1}
                    viewerId={user?.user_id ?? ''}
                    onOpenUrl={(url): void => {
                      void openUrl(url);
                    }}
                    onFollowUp={setDraft}
                    onRegenerate={regenerate}
                  />
                </View>
              ))}
            </ScrollView>
          </ChatRenderProvider>
        )}
        <ComposerDock>
          <XyneAIComposer
            value={draft}
            onChangeText={setDraft}
            isStreaming={isStreaming}
            onSubmit={submit}
            onStop={stop}
            selection={selection}
            onSelectAgent={selectAgent}
            context={context}
            onContextChange={setContext}
          />
        </ComposerDock>
      </KeyboardAvoidingView>
      <ConversationHistorySheet
        isOpen={isHistoryOpen}
        onClose={(): void => setIsHistoryOpen(false)}
        onOpenConversation={openConversation}
        onDeleted={forget}
      />
    </SafeAreaView>
  );
};
