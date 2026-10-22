// ---------------------------------------------------------------------------
// Call detail — mobile port of the dashboard's CallDetailScreen.
// Title + meta, participants and labels, the call timeline (markers, joins,
// recordings), shortcuts into the call thread, and the detailed summary / PRD
// canvases rendered natively, with transcript, sharing, template regeneration
// and Google Docs export in bottom sheets.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Hash, Phone, ScrollText, Tag, Users } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { ChannelVisibility } from '@xyne/shared';

import { AppHeader } from '@/src/components/app-header';
import {
  ShareRecordingSheet,
  type ShareAccessEntry,
} from '@/src/components/recordings/ShareRecordingSheet';
import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { useAllChannels, useChannelDisplayName } from '@/src/hooks/useChannels';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useUsers } from '@/src/hooks/useUsers';
import { useIsInCall } from '@/src/hooks/useRoomMachine';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { cn } from '@/src/utils/cn';

import { useCallDetailData } from '../hooks/use-call-detail-data';
import { useCallLabels } from '../hooks/use-call-labels';
import { useCallSummaryGeneration } from '../hooks/use-call-summary-generation';
import { useCallTimeline } from '../hooks/use-call-timeline';
import { callDetailService, type CallShareTarget } from '../services/call-detail-service';
import {
  formatCallHeldOn,
  formatCallLength,
  parseTranscriptTimestamp,
  type MarkedItem,
  type RecordedSpan,
} from '../utils/call-detail-format';
import { CallTimelineCard } from './call-timeline-card';
import type { CitationTarget } from './canvas-document-view';
import { GoogleDocSheet } from './google-doc-sheet';
import { LabelChip, LabelsSheet, SuggestedLabelChip } from './labels-sheet';
import { ParticipantsSheet } from './participants-sheet';
import { RecordingPlayerSheet } from './recording-player-sheet';
import { SummaryPanel } from './summary-panel';
import { TemplatePickerSheet, useSummaryTemplateOptions } from './template-picker-sheet';
import { TranscriptSheet, type TranscriptTarget } from './transcript-sheet';

const SHEET_TOP_RADIUS = 28;

/** The EntityAccess rows `queries.callById` relates as `shares` (revoked ones are filtered out). */
interface CallShareRow {
  id: string;
  userId?: string | null;
  channelId?: string | null;
  userGroupId?: string | null;
  metadata?: unknown;
}

function getSharePost(metadata: unknown): { channelId: string; conversationId: string } | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const { channelId, conversationId } = metadata as Record<string, unknown>;
  return typeof channelId === 'string' && typeof conversationId === 'string'
    ? { channelId, conversationId }
    : null;
}
const MAX_INLINE_LABELS = 3;

type Sheet = 'participants' | 'labels' | 'templates' | 'share' | 'google-doc' | 'transcript' | null;

function ActionPill({
  icon,
  label,
  onPress,
  disabled,
  primary,
}: {
  icon: ReactElement;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: { bg: string; fg: string };
}): ReactElement {
  return (
    <Pressable
      onPress={(): void => {
        void haptics.buttonTap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      className={cn(
        'h-9 flex-row items-center gap-1.5 rounded-full px-3.5 active:opacity-75',
        !primary && 'bg-secondary',
      )}
      style={{ opacity: disabled ? 0.45 : 1, ...(primary ? { backgroundColor: primary.bg } : {}) }}
    >
      {icon}
      <Text
        className={cn('text-[13px] font-semibold', !primary && 'text-foreground')}
        style={primary ? { color: primary.fg } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function CallDetailScreen({ callId }: { callId: string }): ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const { accentBg, accentFg } = useBubbleAccent();
  const isInCall = useIsInCall();

  const data = useCallDetailData(callId);
  const { call } = data;
  const timeline = useCallTimeline(call, data.currentUserId);
  const labels = useCallLabels(call?.externalId, call?.labels);
  const summary = useCallSummaryGeneration(call);

  const [sheet, setSheet] = useState<Sheet>(null);
  const [transcriptTarget, setTranscriptTarget] = useState<TranscriptTarget | null>(null);
  const [playing, setPlaying] = useState<{ span: RecordedSpan; index: number } | null>(null);
  const closeSheet = useCallback((): void => setSheet(null), []);
  // Revoking is optimistic: the row leaves the list at once, and Zero catches up.
  const [revokedShareIds, setRevokedShareIds] = useState<ReadonlySet<string>>(new Set());

  const allUsers = useUsers();
  const allChannels = useAllChannels();
  const userGroups = useUserGroups();
  const sharedWith = useMemo<ShareAccessEntry[]>(() => {
    if (!call) return [];
    const userName = (id: string): string => allUsers.find(u => u.id === id)?.name ?? id;
    const shares = ((call as { shares?: CallShareRow[] }).shares ?? []).filter(
      share => !revokedShareIds.has(share.id),
    );
    const entries: ShareAccessEntry[] = shares.map(share => {
      const post = getSharePost(share.metadata);
      if (share.userGroupId) {
        return {
          key: share.id,
          kind: 'user_group',
          targetId: share.userGroupId,
          label: userGroups.find(g => g.id === share.userGroupId)?.name ?? share.userGroupId,
          post,
        };
      }
      if (share.channelId) {
        const channel = allChannels.find(c => c.id === share.channelId);
        return {
          key: share.id,
          kind: 'channel',
          targetId: share.channelId,
          label: channel?.name ?? 'Private channel',
          isPrivate: channel?.visibility === ChannelVisibility.PRIVATE,
          post,
        };
      }
      return {
        key: share.id,
        kind: 'user',
        targetId: share.userId ?? '',
        label: userName(share.userId ?? ''),
        post,
      };
    });
    const ownerId = call.createdByUserId;
    return ownerId
      ? [
          { key: `owner-${ownerId}`, kind: 'owner', targetId: ownerId, label: userName(ownerId) },
          ...entries,
        ]
      : entries;
  }, [call, allUsers, allChannels, userGroups, revokedShareIds]);

  const templates = useSummaryTemplateOptions(summary.selectedTemplateId, sheet === 'templates');
  const channelDisplayName = useChannelDisplayName(data.messageChannel, data.currentUserId ?? '');
  const markedMomentSeconds = useMemo(
    () => timeline.markedItems.filter(i => i.type === 'moment').map(i => i.timestampSeconds),
    [timeline.markedItems],
  );

  const canOpenThread = Boolean(
    data.messageChannelId && data.conversationId && data.isChannelMember,
  );
  const title = call?.title?.trim() || 'Untitled call';

  // ── Navigation into the call thread ───────────────────────────────────────

  const openThread = useCallback(
    (extra: { isTranscript?: boolean; messageId?: string }): void => {
      if (!data.messageChannelId || !data.conversationId) return;
      setSheet(null);
      router.push({
        pathname: '/chat/[channelId]/[threadId]',
        params: {
          channelId: data.messageChannelId,
          threadId: data.conversationId,
          isTranscript: extra.isTranscript ? 'true' : 'false',
          ...(extra.messageId ? { messageId: extra.messageId } : {}),
        },
      });
    },
    [data.conversationId, data.messageChannelId, router],
  );

  const openTranscriptAt = useCallback((target: Omit<TranscriptTarget, 'nonce'>): void => {
    setTranscriptTarget({ ...target, nonce: Date.now() });
    setSheet('transcript');
  }, []);

  const handleCitationPress = useCallback(
    (citation: CitationTarget): void => {
      openTranscriptAt({
        segment: citation.segment,
        timestampSeconds: citation.timestamp ? parseTranscriptTimestamp(citation.timestamp) : null,
        tone: 'citation',
      });
    },
    [openTranscriptAt],
  );

  const handleMarkerPress = useCallback(
    (item: MarkedItem): void => {
      openTranscriptAt({
        timestampSeconds: item.timestampSeconds,
        tone: item.type === 'moment' ? 'citation' : 'marker',
      });
    },
    [openTranscriptAt],
  );

  const handleCallAgain = useCallback((): void => {
    if (!call) return;
    if (isInCall) {
      Alert.alert('Already in a call', 'Please leave your current call first.');
      return;
    }
    router.push({
      pathname: '/native-call',
      params: {
        channelId: call.channelId || call.externalId,
        callType: call.callType,
        initiateCall: 'true',
      },
    });
  }, [call, isInCall, router]);

  // ── Render ───────────────────────────────────────────────────────────────

  const heldOn = formatCallHeldOn(call?.startedAt);
  const durationMs =
    call?.startedAt && call?.endedAt && call.endedAt > call.startedAt
      ? call.endedAt - call.startedAt
      : null;
  const callLength = formatCallLength(durationMs);
  const hasMessageLink = Boolean(data.messageChannelId && data.conversationId);
  const postedInLabel =
    data.messageChannel && channelDisplayName && channelDisplayName !== 'Unknown'
      ? `Posted in ${data.messageChannel.scopeType === 'DEFAULT' ? '#' : ''}${channelDisplayName}`
      : 'Go to message';
  const hasSummary = data.tabs.some(tab => tab.kind === 'detailed-summary');
  const generatingLabel = summary.isGenerating
    ? `Generating${summary.request ? ` ${summary.request.templateName}` : ''}…`
    : null;
  const previewParticipants = timeline.participants.slice(0, 4);
  const visibleLabels = labels.labels.slice(0, MAX_INLINE_LABELS);
  const hiddenLabelCount = labels.labels.length - visibleLabels.length;

  const content = !call ? (
    <View className='flex-1 items-center justify-center px-8 gap-3'>
      {data.isResolvingCall ? (
        <ActivityIndicator size='large' />
      ) : (
        <Text className='text-sm text-center' style={{ color: muted }}>
          Call not found, or you do not have access to it.
        </Text>
      )}
    </View>
  ) : (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: insets.bottom + 48,
      }}
    >
      {/* Title + meta */}
      <Text
        selectable
        className='text-[26px] font-semibold leading-[31px] text-foreground'
        style={{ letterSpacing: -0.4 }}
      >
        {title}
      </Text>
      <View className='mt-1.5 flex-row flex-wrap items-center gap-x-2 gap-y-1'>
        {heldOn ? <Text className='text-[13.5px] text-secondary-foreground'>{heldOn}</Text> : null}
        {heldOn && callLength ? (
          <Text className='text-[13.5px] text-secondary-foreground opacity-60'>·</Text>
        ) : null}
        {callLength ? (
          <Text className='text-[13.5px] text-secondary-foreground'>{callLength}</Text>
        ) : null}
        {hasMessageLink ? (
          <>
            {heldOn || callLength ? (
              <Text className='text-[13.5px] text-secondary-foreground opacity-60'>·</Text>
            ) : null}
            <Pressable
              onPress={(): void => openThread({})}
              disabled={!data.isChannelMember}
              hitSlop={6}
              accessibilityRole='link'
              accessibilityHint={
                data.isChannelMember
                  ? 'Opens the call message'
                  : 'You are not a member of this channel'
              }
              className='active:opacity-60'
              style={{ opacity: data.isChannelMember ? 1 : 0.6, maxWidth: '100%' }}
            >
              <Text
                numberOfLines={1}
                className='text-[13.5px] text-secondary-foreground'
                style={{ textDecorationLine: data.isChannelMember ? 'underline' : 'none' }}
              >
                {postedInLabel}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {/* Participants + labels */}
      <View className='mt-4 flex-row flex-wrap items-center gap-2'>
        <Pressable
          onPress={(): void => setSheet('participants')}
          disabled={timeline.participants.length === 0}
          accessibilityRole='button'
          accessibilityLabel={`${timeline.participants.length} participants`}
          className='h-8 flex-row items-center gap-2 rounded-full bg-secondary pl-1 pr-3 active:opacity-70'
        >
          {timeline.isRosterLoading && previewParticipants.length === 0 ? (
            <View className='pl-2'>
              <Users size={14} color={muted} />
            </View>
          ) : (
            <View className='flex-row'>
              {previewParticipants.map((participant, index) => (
                <View
                  key={participant.userId}
                  style={{
                    marginLeft: index === 0 ? 0 : -8,
                    borderRadius: 13,
                    borderWidth: 1.5,
                    borderColor: 'transparent',
                  }}
                >
                  <Avatar
                    userIds={[participant.userId]}
                    fallbackUsers={[
                      {
                        id: participant.userId,
                        name: participant.name,
                        picture: participant.picture,
                      },
                    ]}
                    size={24}
                  />
                </View>
              ))}
            </View>
          )}
          <Text className='text-[12.5px] font-medium text-foreground'>
            {timeline.participants.length > 0
              ? `${timeline.participants.length} people`
              : 'Participants'}
          </Text>
        </Pressable>

        {visibleLabels.map(label => (
          <Pressable
            key={label.id}
            onPress={(): void => setSheet('labels')}
            className='active:opacity-70'
          >
            <LabelChip name={label.name} />
          </Pressable>
        ))}
        {Array.from({ length: labels.pendingCount }, (_, index) => (
          <View
            key={`pending-${index}`}
            className='h-7 w-14 rounded-lg bg-secondary opacity-60'
            accessibilityElementsHidden
          />
        ))}
        {hiddenLabelCount > 0 ? (
          <Pressable
            onPress={(): void => setSheet('labels')}
            className='h-7 justify-center rounded-lg bg-secondary px-2 active:opacity-70'
          >
            <Text className='text-[12.5px] font-medium text-secondary-foreground'>{`+${hiddenLabelCount}`}</Text>
          </Pressable>
        ) : null}
        {data.isCallAudience ? (
          <Pressable
            onPress={(): void => setSheet('labels')}
            accessibilityRole='button'
            accessibilityLabel={labels.labels.length > 0 ? 'Edit labels' : 'Add label'}
            className='h-7 flex-row items-center gap-1 rounded-lg border border-dashed border-border px-2 active:opacity-70'
          >
            <Tag size={12} color={muted} />
            <Text className='text-[12.5px] font-medium text-secondary-foreground'>
              {labels.labels.length > 0 ? 'Edit' : 'Add label'}
            </Text>
          </Pressable>
        ) : null}
        {data.isCallAudience
          ? labels.suggestions.map(label => (
              <SuggestedLabelChip
                key={label.id}
                name={label.name}
                onConfirm={(): void => void labels.confirmSuggestion(label.id)}
                onDismiss={(): void => void labels.dismissSuggestion(label.id)}
              />
            ))
          : null}
      </View>

      {/* Actions */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className='mt-4 -mx-[18px]'
        contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}
      >
        {data.isCallAudience && hasSummary ? (
          <ActionPill
            icon={<Hash size={14} color={accentFg} />}
            label='Post to channel'
            onPress={(): void => setSheet('share')}
            primary={{ bg: accentBg, fg: accentFg }}
          />
        ) : null}
        {call.transcript || hasMessageLink ? (
          <ActionPill
            icon={<ScrollText size={14} color={foreground} />}
            label='Transcript'
            onPress={(): void => {
              setTranscriptTarget(null);
              setSheet('transcript');
            }}
          />
        ) : null}
        {data.isOwner && hasSummary ? (
          <ActionPill
            icon={<FileText size={14} color={foreground} />}
            label='Google Docs'
            onPress={(): void => setSheet('google-doc')}
          />
        ) : null}
        <ActionPill
          icon={<Phone size={14} color={foreground} />}
          label='Call again'
          onPress={handleCallAgain}
        />
      </ScrollView>

      {/* Timeline */}
      {timeline.spanSeconds !== null ? (
        <View className='mt-5'>
          <CallTimelineCard
            spanSeconds={timeline.spanSeconds}
            markedItems={timeline.markedItems}
            participantEvents={timeline.participantEvents}
            recordedSpans={timeline.recordedSpans}
            onMarkerPress={handleMarkerPress}
            onRecordingPress={(span, index): void => setPlaying({ span, index })}
          />
        </View>
      ) : null}

      {/* Summary / PRD canvases */}
      <View className='mt-6'>
        <SummaryPanel
          tabs={data.tabs}
          isLoading={data.isTabContentLoading}
          aiSummary={call.aiSummary ?? null}
          canvasNonce={summary.canvasNonce}
          templateLabel={templates.selected.name}
          templateIcon={templates.selected.icon}
          isGenerating={summary.isGenerating}
          generatingLabel={generatingLabel}
          canChangeTemplate={data.isCallAudience && hasSummary}
          onTemplatePress={(): void => setSheet('templates')}
          onCitationPress={handleCitationPress}
        />
      </View>
    </ScrollView>
  );

  return (
    <View className='flex-1 bg-primary-bg'>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppHeader absolute={false}>
          <HeaderBackButton
            liquidGlass
            accessibilityLabel='Back to Calls'
            onPress={(): void => router.back()}
          />
          <Text
            className='flex-1 mx-3 text-center text-[15px] font-semibold text-foreground'
            numberOfLines={1}
          >
            {call ? 'Call details' : ''}
          </Text>
          <View style={{ width: 44 }} />
        </AppHeader>
        <View
          className='flex-1 overflow-hidden bg-card'
          style={{ borderTopLeftRadius: SHEET_TOP_RADIUS, borderTopRightRadius: SHEET_TOP_RADIUS }}
        >
          {content}
        </View>
      </SafeAreaView>

      {call ? (
        <>
          <ParticipantsSheet
            isOpen={sheet === 'participants'}
            onClose={closeSheet}
            participants={timeline.participants}
          />
          <LabelsSheet
            isOpen={sheet === 'labels'}
            onClose={closeSheet}
            labels={labels.labels}
            suggestions={labels.suggestions}
            canEdit={data.isCallAudience}
            onChange={(next): void => void labels.setLabels(next)}
            onConfirmSuggestion={(id): void => void labels.confirmSuggestion(id)}
            onDismissSuggestion={(id): void => void labels.dismissSuggestion(id)}
          />
          <TemplatePickerSheet
            isOpen={sheet === 'templates'}
            onClose={closeSheet}
            options={templates.options}
            selectedId={templates.selected.id}
            isLoading={templates.isLoading}
            isGenerating={summary.isGenerating}
            generatingTemplateId={summary.request?.templateId}
            onPick={(option): void => {
              setSheet(null);
              summary.regenerate(option.id, option.name);
            }}
          />
          <TranscriptSheet
            isOpen={sheet === 'transcript'}
            onClose={closeSheet}
            callExternalId={call.externalId}
            title={title}
            target={transcriptTarget}
            markedMomentSeconds={markedMomentSeconds}
            canOpenThread={canOpenThread}
            onOpenThread={(): void => openThread({ isTranscript: true })}
          />
          {data.isOwner ? (
            <GoogleDocSheet
              isOpen={sheet === 'google-doc'}
              onClose={closeSheet}
              callExternalId={call.externalId}
              title={title}
              webReturnPath={`/calls/${call.externalId}/detail`}
            />
          ) : null}
          <AppBottomSheet
            isOpen={sheet === 'share'}
            onOpenChange={(open): void => {
              if (!open) closeSheet();
            }}
            mode='fullscreen'
            keyboardBehavior='extend'
          >
            <ShareRecordingSheet
              callId={call.externalId}
              isOpen={sheet === 'share'}
              onClose={closeSheet}
              title='Post to channel'
              errorMessage='Failed to post the call summary.'
              onShare={(targets): Promise<void> =>
                callDetailService.grantCallAccess(call.externalId, targets)
              }
              sharedWith={sharedWith}
              onRevoke={async (entry): Promise<void> => {
                if (entry.kind === 'owner') return;
                const target: CallShareTarget = { type: entry.kind, id: entry.targetId };
                setRevokedShareIds(prev => new Set(prev).add(entry.key));
                try {
                  await callDetailService.revokeCallAccess(call.externalId, [target]);
                } catch (err) {
                  setRevokedShareIds(prev => {
                    const next = new Set(prev);
                    next.delete(entry.key);
                    return next;
                  });
                  throw err;
                }
              }}
              onOpenSharedPost={(entry): void => {
                if (!entry.post) return;
                setSheet(null);
                router.push({
                  pathname: '/chat/[channelId]/[threadId]',
                  params: { channelId: entry.post.channelId, threadId: entry.post.conversationId },
                });
              }}
            />
          </AppBottomSheet>
          <RecordingPlayerSheet
            span={playing?.span ?? null}
            index={playing?.index ?? 0}
            callExternalId={call.externalId}
            onClose={(): void => setPlaying(null)}
          />
        </>
      ) : null}
    </View>
  );
}
