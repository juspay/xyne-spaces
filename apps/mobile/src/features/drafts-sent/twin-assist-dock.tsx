import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Pencil,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react-native';
import { type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';

import {
  adjacentTwinDraftId,
  canEditTwinDraft,
  formatTwinIntentLabel,
  twinDraftBodyPreview,
  twinDraftPagerLabel,
  twinDraftSendLabel,
} from './twin-draft-assist';
import type { TwinReplyDraftView } from './twin-draft-utils';

type TwinAssistDockProps = {
  view: TwinReplyDraftView;
  drafts: readonly TwinReplyDraftView[];
  isEditing: boolean;
  isPending: boolean;
  /** False when a schedule strip sits above this panel in the same bubble. */
  roundTop?: boolean;
  onBack: () => void;
  onSelectDraftId: (draftId: string) => void;
  onJumpToSource?: () => void;
  onWhy: () => void;
  onReject: () => void;
  onEdit: () => void;
  onSend: () => void;
};

const stopAndRun = (event: GestureResponderEvent, action: () => void): void => {
  event.stopPropagation();
  action();
};

export function TwinAssistDock({
  view,
  drafts,
  isEditing,
  isPending,
  roundTop = true,
  onBack,
  onSelectDraftId,
  onJumpToSource,
  onWhy,
  onReject,
  onEdit,
  onSend,
}: TwinAssistDockProps): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const border = useCSSVariable('--color-border') as string;
  const { accentBg, accentFg } = useBubbleAccent();
  const pager = twinDraftPagerLabel(drafts, view.id);
  const previousId = adjacentTwinDraftId(drafts, view.id, -1);
  const nextId = adjacentTwinDraftId(drafts, view.id, 1);
  const canEdit = canEditTwinDraft(view);
  const hasWhy = Boolean(view.reasoning?.trim());

  if (isEditing) {
    return (
      <View
        collapsable={false}
        className={cn('flex-row items-center gap-2 py-1.5', roundTop ? 'rounded-t-[20px]' : null)}
        style={{ borderBottomWidth: 0.5, borderBottomColor: border }}
      >
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Discard twin draft edits'
          hitSlop={12}
          disabled={isPending}
          onPress={event => stopAndRun(event, onBack)}
          className='size-8 items-center justify-center rounded-full active:opacity-70'
        >
          <ChevronLeft size={18} color={foreground} />
        </Pressable>
        <Sparkles size={14} color={foreground} />
        <Text
          className='flex-1 text-[13px] font-semibold'
          style={{ color: foreground }}
          numberOfLines={1}
        >
          Editing draft
          {view.senderName ? ` · reply to ${view.senderName}` : ''}
        </Text>
        {isPending ? <ActivityIndicator size='small' /> : null}
      </View>
    );
  }

  return (
    <View
      collapsable={false}
      className={cn(
        'gap-2 bg-conversation-input-pill-bg px-3 py-2.5',
        roundTop ? 'rounded-t-[20px]' : null,
      )}
      style={{ borderBottomWidth: 0.5, borderBottomColor: border }}
    >
      <View className='flex-row items-center gap-2'>
        <Sparkles size={14} color={foreground} />
        <Text
          className='min-w-0 flex-1 text-[13px] font-semibold'
          style={{ color: foreground }}
          numberOfLines={1}
        >
          {formatTwinIntentLabel(view)}
        </Text>
        {pager ? (
          <View className='flex-row items-center'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Previous twin draft'
              hitSlop={8}
              disabled={!previousId || isPending}
              onPress={event => previousId && stopAndRun(event, () => onSelectDraftId(previousId))}
              className={cn('size-7 items-center justify-center', !previousId ? 'opacity-30' : '')}
            >
              <ChevronLeft size={16} color={foreground} />
            </Pressable>
            <Text className='text-[11px] tabular-nums' style={{ color: foreground }}>
              {pager}
            </Text>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Next twin draft'
              hitSlop={8}
              disabled={!nextId || isPending}
              onPress={event => nextId && stopAndRun(event, () => onSelectDraftId(nextId))}
              className={cn('size-7 items-center justify-center', !nextId ? 'opacity-30' : '')}
            >
              <ChevronRight size={16} color={foreground} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {view.senderName || onJumpToSource ? (
        <Pressable
          accessibilityRole={onJumpToSource ? 'button' : undefined}
          accessibilityLabel='Jump to source message'
          disabled={!onJumpToSource}
          onPress={event => onJumpToSource && stopAndRun(event, onJumpToSource)}
        >
          <Text className='text-[12px]' style={{ color: foreground }} numberOfLines={1}>
            {view.senderName ? `From ${view.senderName}` : 'Source message'}
            {onJumpToSource ? ' · Jump to message' : ''}
          </Text>
        </Pressable>
      ) : null}

      <Text className='text-[14px] leading-5' style={{ color: foreground }} numberOfLines={3}>
        {twinDraftBodyPreview(view)}
      </Text>

      <View className='flex-row flex-wrap items-center gap-1.5'>
        {hasWhy ? (
          <DockAction
            label='Why?'
            icon={<HelpCircle size={14} color={foreground} />}
            onPress={onWhy}
            disabled={isPending}
          />
        ) : null}
        <DockAction
          label='Reject'
          icon={<X size={14} color={foreground} />}
          onPress={onReject}
          disabled={isPending}
        />
        {canEdit ? (
          <DockAction
            label='Edit'
            icon={<Pencil size={14} color={foreground} />}
            onPress={onEdit}
            disabled={isPending}
          />
        ) : null}
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={twinDraftSendLabel(view)}
          disabled={isPending}
          onPress={event => stopAndRun(event, onSend)}
          className='ml-auto size-8 items-center justify-center rounded-full active:opacity-80'
          style={{ backgroundColor: accentBg, opacity: isPending ? 0.6 : 1 }}
        >
          {isPending ? (
            <ActivityIndicator size='small' color={accentFg} />
          ) : (
            <SendHorizontal size={20} color={accentFg} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const DockAction = ({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: ReactElement;
  onPress: () => void;
  disabled: boolean;
}): ReactElement => {
  const foreground = useCSSVariable('--color-foreground') as string;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      disabled={disabled}
      onPress={event => stopAndRun(event, onPress)}
      className='h-8 flex-row items-center gap-1 rounded-full bg-muted/20 px-2.5 active:opacity-80'
      style={{ opacity: disabled ? 0.55 : 1 }}
    >
      {icon}
      <Text className='text-[12px] font-medium' style={{ color: foreground }}>
        {label}
      </Text>
    </Pressable>
  );
};
