import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Headphones } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import { router, useLocalSearchParams } from 'expo-router';

import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';

import { useConversationComposer } from './conversation-composer-context';
import { ConversationComposerMarkdownBody } from './conversation-composer-markdown-body';
import { DebugBoundary } from './utils/debug-boundary';
import { htmlToMD } from './utils/htmlToMD';
import { useMentionPress } from './utils/useMentionPress';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';

type CallMetadata = {
  callId?: string;
  callTitle?: string;
  operation?: string;
  durationMs?: number;
  isCallMessage?: boolean;
};

const parseCallMetadata = (raw: string | null | undefined): CallMetadata | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CallMetadata;
    return parsed.isCallMessage ? parsed : null;
  } catch {
    return null;
  }
};

const formatStartTime = (createdAt: number): string =>
  new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const formatDuration = (durationMs: number): string => {
  if (durationMs < 60_000) return `${Math.max(1, Math.floor(durationMs / 1000))}s`;
  const minutes = Math.floor(durationMs / 60_000);
  return `${minutes}min`;
};

const CallStub = memo((): ReactElement | null => {
  const { summary, item } = useConversationComposer();
  const iconColor = useCSSVariable('--color-conversation-composer-call-icon') as string;

  const callMeta = useMemo(() => parseCallMetadata(summary?.metadata), [summary?.metadata]);

  const openThread = useCallback(
    (isTranscript: boolean = false): void => {
      if (!item.channelId || !item.conversationId) return;
      router.push({
        pathname: '/chat/[channelId]/[threadId]',
        params: {
          channelId: item.channelId,
          threadId: item.conversationId,
          isTranscript: isTranscript ? 'true' : 'false',
        },
      });
    },
    [item.channelId, item.conversationId],
  );

  if (!summary || !callMeta) return null;

  const title = callMeta.callTitle ?? 'Call';
  const startTime = formatStartTime(summary.createdAt);
  const duration =
    typeof callMeta.durationMs === 'number' ? formatDuration(callMeta.durationMs) : null;
  // const isActive = callMeta.operation === 'call_active';

  return (
    <DebugBoundary>
      <View className='w-[80%] self-center bg-conversation-composer-call-bg rounded-2xl p-2 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
        <View className='flex-row gap-2 items-start bg-conversation-composer-call-pill-bg rounded-lg p-1.5'>
          <View className='bg-conversation-composer-call-icon-bg rounded-full p-1 items-center justify-center'>
            <Headphones size={20} color={iconColor} />
          </View>
          <View className='flex-1 min-w-0 gap-1'>
            <Text
              numberOfLines={1}
              className='text-[14px] font-medium text-conversation-composer-call-title leading-[1.2]'
            >
              {title}
            </Text>
            <View className='flex-row items-center gap-1'>
              <Text className='text-[12px] font-medium text-conversation-composer-call-meta leading-[1.35]'>
                {startTime}
              </Text>
              {duration ? (
                <>
                  <Text className='text-[12px] font-medium text-conversation-composer-call-meta leading-[1.35]'>
                    ·
                  </Text>
                  <Text className='text-[12px] font-medium text-conversation-composer-call-meta leading-[1.35]'>
                    {duration}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        </View>
        <View className='h-px bg-conversation-composer-call-divider w-full my-1.5' />
        <View className='flex-row items-center justify-around w-full'>
          <Pressable className='py-1 items-center justify-center' onPress={() => openThread(false)}>
            <Text className='text-[12px] font-semibold text-conversation-composer-call-action'>
              {'View Summary'}
            </Text>
          </Pressable>
          <View className='w-px self-stretch bg-conversation-composer-call-divider' />
          <Pressable className='py-1 items-center justify-center' onPress={() => openThread(true)}>
            <Text className='text-[12px] font-semibold text-conversation-composer-call-action'>
              {'View Transcript'}
            </Text>
          </Pressable>
        </View>
      </View>
    </DebugBoundary>
  );
});
CallStub.displayName = 'ConversationComposer.SystemMessage.CallStub';

type MentionedUser = { userId: string };
type NonParticipantMetadata = {
  messageSubtype: 'user_not_in_channel';
  mentionedUsers?: MentionedUser[];
  channelId?: string;
  canAddUsers?: boolean;
};

const parseNonParticipantMetadata = (
  raw: string | null | undefined,
): NonParticipantMetadata | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed['messageSubtype'] === 'user_not_in_channel'
      ? (parsed as unknown as NonParticipantMetadata)
      : null;
  } catch {
    return null;
  }
};

const NonParticipantStub = memo((): ReactElement | null => {
  const { summary, currentUser } = useConversationComposer();
  const zero = useZero();
  const { channelId: routeChannelId } = useLocalSearchParams<{ channelId?: string }>();
  const handleMentionPress = useMentionPress();

  const systemText = useCSSVariable('--color-conversation-composer-system-text') as string;
  const foregroundMuted = useCSSVariable('--color-muted') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const { theme } = useUniwind();
  const linkColor = theme === 'dark' ? '#3CB16F' : '#288451';

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = useMemo(() => parseNonParticipantMetadata(summary?.metadata), [summary?.metadata]);

  const markdown = useMemo(() => htmlToMD(summary?.content ?? ''), [summary?.content]);
  const spacedMarkdown = useMemo(
    () => markdown.replace(/,\s*(?=\[\*\*@)/g, ',  ').replace(/(?<=\))(?=\[\*\*@)/g, '  '),
    [markdown],
  );

  const markdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground: systemText,
        foregroundMuted,
        cardBg,
        brand,
        linkColor,
        variant: 'system',
      }),
    [systemText, foregroundMuted, cardBg, brand, linkColor],
  );

  const userIds = useMemo(
    () => (meta?.mentionedUsers ?? []).map(u => u.userId).filter(Boolean),
    [meta?.mentionedUsers],
  );
  const resolvedChannelId = meta?.channelId ?? routeChannelId ?? null;
  const canAddMembers = meta?.canAddUsers !== false;

  const runAction = useCallback(
    async (action: 'add_all' | 'ignore_all') => {
      if (!summary || !resolvedChannelId || userIds.length === 0) return;
      try {
        setError(null);
        setIsLoading(true);
        await zero.mutate(
          mutators.messages.handleNonParticipantAction({
            messageId: summary.messageId,
            action,
            userIds,
            channelId: resolvedChannelId,
          }),
        );
      } catch {
        setError(action === 'add_all' ? 'Failed to add users' : 'Failed to dismiss message');
      } finally {
        setIsLoading(false);
      }
    },
    [summary, resolvedChannelId, userIds, zero],
  );

  if (!summary || !meta) return null;
  if (summary.visibleTo && summary.visibleTo !== currentUser?.id) return null;

  const showActions = userIds.length > 0;

  return (
    <DebugBoundary>
      <View className='bg-conversation-composer-system-bg rounded-lg p-1.5 gap-1.5 my-4 max-w-[95%] self-center light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
        <ConversationComposerMarkdownBody
          markdown={spacedMarkdown}
          markdownStyle={markdownStyle}
          containerStyle={{ maxWidth: '100%' }}
          selectable={false}
          onLinkPress={({ url }) => {
            void handleMentionPress(url);
          }}
        />

        {error ? <Text className='text-[12px] font-medium text-status-danger'>{error}</Text> : null}

        {showActions ? (
          <>
            <View className='h-px w-full bg-conversation-composer-call-divider' />
            <View className='flex-row items-center w-full'>
              {canAddMembers ? (
                <Pressable
                  disabled={isLoading}
                  className='flex-1 py-1 items-center justify-center'
                  onPress={() => void runAction('add_all')}
                >
                  <Text className='text-[12px] font-semibold leading-[1.35] text-conversation-composer-call-action'>
                    {isLoading ? 'Adding…' : 'Add Them'}
                  </Text>
                </Pressable>
              ) : null}
              {canAddMembers ? (
                <View className='w-px self-stretch bg-conversation-composer-call-divider' />
              ) : null}
              <Pressable
                disabled={isLoading}
                className='flex-1 py-1 items-center justify-center'
                onPress={() => void runAction('ignore_all')}
              >
                <Text className='text-[12px] font-semibold leading-[1.35] text-conversation-composer-call-action'>
                  {canAddMembers ? 'Do Nothing' : 'Got it'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </DebugBoundary>
  );
});
NonParticipantStub.displayName = 'ConversationComposer.SystemMessage.NonParticipantStub';

const SystemMessage = memo((): ReactElement | null => {
  const { summary } = useConversationComposer();

  const callMeta = useMemo(() => parseCallMetadata(summary?.metadata), [summary?.metadata]);
  const nonParticipantMeta = useMemo(
    () => parseNonParticipantMetadata(summary?.metadata),
    [summary?.metadata],
  );

  if (!summary) return null;

  if (callMeta) return <CallStub />;
  if (nonParticipantMeta) return <NonParticipantStub />;

  return (
    <DebugBoundary>
      <View className='bg-conversation-composer-system-bg rounded-lg p-1.5 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)] my-4 max-w-[95%] self-center'>
        <Text className='text-[12.5px] font-medium leading-5 tracking-[-0.16px] text-conversation-composer-system-text text-center'>
          {summary.content}
        </Text>
      </View>
    </DebugBoundary>
  );
});
SystemMessage.displayName = 'ConversationComposer.SystemMessage';

export { SystemMessage };
