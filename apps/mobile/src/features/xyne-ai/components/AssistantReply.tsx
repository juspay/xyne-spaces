import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Circle,
  CornerDownRight,
  RefreshCw,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { BriefCitation } from '@/src/features/morning-brief/api/dailyBriefApi';
import { CitationSourcesSheet } from '@/src/features/morning-brief/components/CitationSourcesSheet';
import { useOpenCitation } from '@/src/features/morning-brief/hooks/useBriefRenderContext';
import { DASHBOARD_ORIGIN, PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import { useUsers } from '@/src/hooks/useUsers';
import { haptics } from '@/src/utils/haptics';
import { formatTime } from '@/src/utils/timeSelection';

import type { PendingAction, PlanTodo } from '../api/xyneAIEvents';
import { answerText, type AssistantTurn } from '../model/assistantTurn';
import { absolutizeDashboardLinks, buildMentionResolver, linkMentions } from '../model/answerLinks';
import type { AskAIErrorInfo } from '../model/askAIError';
import {
  citationNumbers,
  citationSources,
  linkCitations,
  resolveCitationLink,
} from '../model/citations';
import { turnDurationLabel } from '../model/turnTimeline';
import { unpresentedPendingActions } from '../model/uiFlows';
import { FlowCards } from './FlowCards';
import { PendingActions } from './PendingActions';
import { StreamingMarkdown } from './StreamingMarkdown';
import { TurnActions } from './TurnActions';
import { TurnOutputs } from './TurnOutputs';
import { TurnTimeline } from './TurnTimeline';

const TodoIcon = ({ status }: { status: PlanTodo['status'] }): ReactElement => {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const danger = useCSSVariable('--color-settings-icon-red') as string;
  switch (status) {
    case 'in_progress':
      return <ActivityIndicator size='small' color={muted} />;
    case 'completed':
      return <Check size={14} color={muted} />;
    case 'failed':
      return <AlertCircle size={14} color={danger} />;
    case 'pending':
      return <Circle size={12} color={muted} />;
  }
};

const PlanChecklist = ({ plan }: { plan: NonNullable<AssistantTurn['plan']> }): ReactElement => (
  <View className='gap-1.5 rounded-xl border border-border p-3'>
    {plan.title ? (
      <Text className='text-[14px] font-medium text-foreground'>{plan.title}</Text>
    ) : null}
    {plan.todos.map((todo, index) => (
      <View key={todo.id ?? index} className='flex-row items-center gap-2'>
        <View className='h-4 w-4 items-center justify-center'>
          <TodoIcon status={todo.status} />
        </View>
        <Text className='min-w-0 flex-1 text-[14px] text-secondary-foreground'>{todo.title}</Text>
      </View>
    ))}
  </View>
);

const TurnErrorCard = ({
  error,
  onRetry,
}: {
  error: AskAIErrorInfo;
  onRetry: (() => void) | undefined;
}): ReactElement => {
  const [showRaw, setShowRaw] = useState(false);
  const danger = useCSSVariable('--color-settings-icon-red') as string;

  return (
    <View
      accessibilityRole='alert'
      className='flex-row items-start gap-2 rounded-xl border border-settings-icon-red/20 bg-settings-icon-red/5 p-3'
    >
      <AlertTriangle size={16} color={danger} />
      <View className='min-w-0 flex-1 gap-1'>
        <Text className='text-[14px] font-medium text-settings-icon-red'>
          {error.title}
          {error.code ? <Text className='text-[11px] opacity-70'> ({error.code})</Text> : null}
        </Text>
        <Text className='text-[14px] text-foreground'>{error.message}</Text>
        {error.helpText ? (
          <Text className='text-[13px] text-secondary-foreground'>{error.helpText}</Text>
        ) : null}
        {error.rawError ? (
          <>
            <Pressable
              accessibilityRole='button'
              accessibilityState={{ expanded: showRaw }}
              onPress={(): void => setShowRaw(value => !value)}
              className='self-start py-1'
            >
              <Text className='text-[12px] text-secondary-foreground'>Technical details</Text>
            </Pressable>
            {showRaw ? (
              <Text selectable className='font-mono text-[11px] text-secondary-foreground'>
                {error.rawError}
              </Text>
            ) : null}
          </>
        ) : null}
        {onRetry ? (
          <Pressable
            accessibilityRole='button'
            onPress={onRetry}
            className='mt-1 flex-row items-center gap-1.5 self-start rounded-lg border border-settings-icon-red/30 px-3 py-1.5 active:opacity-60'
          >
            <RefreshCw size={13} color={danger} />
            <Text className='text-[13px] font-medium text-settings-icon-red'>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const FollowUps = ({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}): ReactElement => {
  const color = useCSSVariable('--color-secondary-foreground') as string;

  return (
    <View>
      <Text className='mb-1 text-xs font-medium text-secondary-foreground'>Follow up</Text>
      {suggestions.map((suggestion, index) => (
        <Pressable
          key={suggestion}
          accessibilityRole='button'
          onPress={(): void => {
            void haptics.buttonTap();
            onSelect(suggestion);
          }}
          className={`flex-row items-start gap-2 py-2.5 active:opacity-60 ${index > 0 ? 'border-t border-border' : ''}`}
        >
          <View className='mt-0.5'>
            <CornerDownRight size={14} color={color} />
          </View>
          <Text className='min-w-0 flex-1 text-[14px] leading-5 text-foreground'>{suggestion}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const TurnFooter = ({ turn }: { turn: AssistantTurn }): ReactElement => {
  const finishedAt = new Date(turn.startedAt + (turn.durationMs ?? 0));
  const label = [
    turnDurationLabel(turn.durationMs, turn.status === 'stopped'),
    formatTime(finishedAt),
  ]
    .filter(Boolean)
    .join(' · ');
  return <Text className='text-[11px] text-secondary-foreground'>{label}</Text>;
};

export const AssistantReply = ({
  turn,
  isLatest,
  viewerId,
  conversationId,
  onOpenUrl,
  onFollowUp,
  onRegenerate,
  onPendingAction,
  onFlowClose,
}: {
  turn: AssistantTurn;
  isLatest: boolean;
  viewerId: string;
  conversationId: string;
  onOpenUrl: (url: string) => void;
  onFollowUp: (suggestion: string) => void;
  onRegenerate: () => void;
  /** Sends the user's decision for a paused tool call; without it, pending calls are not shown. */
  onPendingAction?: (action: PendingAction, approved: boolean) => Promise<void>;
  /** A flow card closed after an action, so the stored turn has moved on. */
  onFlowClose: () => void;
}): ReactElement => {
  const [sourceGroup, setSourceGroup] = useState<BriefCitation[] | null>(null);
  const openCitation = useOpenCitation();
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;

  const sources = useMemo(() => citationSources(turn.tools), [turn.tools]);
  const answer = answerText(turn);
  const numbers = useMemo(() => citationNumbers(answer, sources), [answer, sources]);

  const users = useUsers();
  const resolveMention = useMemo(
    () => buildMentionResolver(turn.userTags, users),
    [turn.userTags, users],
  );
  const renderableMarkdown = (text: string): string =>
    absolutizeDashboardLinks(linkMentions(linkCitations(text, numbers, sources), resolveMention), {
      app: PUBLIC_DEEP_LINK_ORIGIN,
      dashboard: DASHBOARD_ORIGIN,
    });

  const openLink = useCallback(
    (url: string): void => {
      const tap = resolveCitationLink(url, sources);
      if (tap?.kind === 'citation') openCitation(tap.citation);
      else if (tap?.kind === 'group') setSourceGroup(tap.citations);
      else onOpenUrl(url);
    },
    [sources, openCitation, onOpenUrl],
  );

  const pendingActions = useMemo(
    () => unpresentedPendingActions(turn.pendingActions, turn.uiFlows),
    [turn.pendingActions, turn.uiFlows],
  );
  const isDone = turn.status !== 'streaming';

  return (
    <View className='gap-3'>
      <TurnTimeline
        turn={turn}
        renderText={(text, isStreaming): ReactElement => (
          <StreamingMarkdown
            markdown={renderableMarkdown(text)}
            isStreaming={isStreaming}
            viewerId={viewerId}
            onOpenUrl={openLink}
          />
        )}
      />
      {turn.plan ? <PlanChecklist plan={turn.plan} /> : null}
      {turn.uiFlows.length > 0 ? (
        <FlowCards
          flows={turn.uiFlows}
          conversationId={conversationId}
          messageId={turn.messageId}
          viewerId={viewerId}
          onOpenUrl={onOpenUrl}
          onClose={onFlowClose}
        />
      ) : null}
      {onPendingAction && pendingActions.length > 0 ? (
        <PendingActions actions={pendingActions} onRespond={onPendingAction} />
      ) : null}
      {isDone ? (
        <TurnOutputs turn={turn} onOpenUrl={onOpenUrl} onOpenCanvas={openCitation} />
      ) : null}
      {turn.error ? (
        <TurnErrorCard error={turn.error} onRetry={isLatest ? onRegenerate : undefined} />
      ) : null}
      {isDone && isLatest && turn.followUps.length > 0 ? (
        <FollowUps suggestions={turn.followUps} onSelect={onFollowUp} />
      ) : null}
      {isDone && !turn.error ? <TurnFooter turn={turn} /> : null}
      {isDone ? (
        <TurnActions
          answer={answer}
          messageId={turn.messageId}
          initialRating={turn.rating}
          onRegenerate={isLatest ? onRegenerate : undefined}
        />
      ) : null}
      <CitationSourcesSheet
        citations={sourceGroup}
        onClose={(): void => setSourceGroup(null)}
        onOpenCitation={openCitation}
        foregroundColor={foreground}
        mutedColor={muted}
      />
    </View>
  );
};
