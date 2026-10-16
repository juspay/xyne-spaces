import { memo, useEffect, useState, type ReactElement } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, Text, View } from 'react-native';
import { Check, ChevronLeft, ChevronRight, Copy, Paperclip, Pencil } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useChatRenderTokens } from '@/src/features/chat/v3/theme/ChatRenderProvider';
import { formatTime } from '@/src/utils/timeSelection';

import type { PendingAction } from '../api/xyneAIEvents';
import type { AttachedContextItem, AttachedFile } from '../api/xyneAIRequest';
import type { ChatTurn } from '../model/assistantTurn';
import { AssistantReply } from './AssistantReply';
import { ICONS } from './ContextPickerSheet';
import { IconButton } from './IconButton';
import { openAttachment, Thumbnail } from './TurnOutputs';

const COPIED_MS = 1500;
const THUMBNAIL_SIZE = 160;

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

  const { currentUserBubbleBg, rootTextUser } = useChatRenderTokens();
  const CopyIcon = copied ? Check : Copy;
  return (
    <View className='max-w-[78%] items-end gap-1 self-end'>
      {turn.attachments.map((file, index) => (
        <Attachment key={`${index}:${file.filename}`} file={file} />
      ))}
      <View className='rounded-3xl px-4 py-2.5' style={{ backgroundColor: currentUserBubbleBg }}>
        <Text selectable className='text-[15px] leading-6' style={{ color: rootTextUser }}>
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

export const TurnRow = memo(function TurnRow({
  turn,
  isLatest,
  isStreaming,
  canEdit,
  versionIndex,
  versionTotal,
  viewerId,
  conversationId,
  onLatestLayout,
  onSwitchVersion,
  onEdit,
  onOpenUrl,
  onFlowClose,
  onFollowUp,
  onRegenerate,
  onPendingAction,
}: {
  turn: ChatTurn;
  isLatest: boolean;
  /** True only for the latest turn while it streams, so older rows are untouched when streaming starts or stops. */
  isStreaming: boolean;
  canEdit: boolean;
  versionIndex: number | undefined;
  versionTotal: number | undefined;
  viewerId: string;
  conversationId: string;
  onLatestLayout: (height: number) => void;
  onSwitchVersion: (turn: ChatTurn, step: 1 | -1) => void;
  onEdit: (turn: ChatTurn) => void;
  onOpenUrl: (url: string) => void;
  onFlowClose: () => void;
  onFollowUp: (suggestion: string) => void;
  onRegenerate: () => void;
  onPendingAction: (turn: ChatTurn, action: PendingAction, approved: boolean) => Promise<void>;
}): ReactElement {
  return (
    <View
      className='gap-6'
      onLayout={
        isStreaming
          ? ({ nativeEvent }): void => onLatestLayout(nativeEvent.layout.height)
          : undefined
      }
    >
      <UserBubble
        turn={turn}
        version={
          versionIndex === undefined || versionTotal === undefined
            ? undefined
            : { index: versionIndex, total: versionTotal }
        }
        onSwitchVersion={(step): void => onSwitchVersion(turn, step)}
        onEdit={canEdit ? (): void => onEdit(turn) : undefined}
      />
      <AssistantReply
        turn={turn.reply}
        isLatest={isLatest}
        viewerId={viewerId}
        conversationId={conversationId}
        onOpenUrl={onOpenUrl}
        onFlowClose={onFlowClose}
        onFollowUp={onFollowUp}
        onRegenerate={onRegenerate}
        onPendingAction={(action, approved): Promise<void> =>
          onPendingAction(turn, action, approved)
        }
      />
    </View>
  );
});
