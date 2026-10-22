import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { Alert, Keyboard, TextInput } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import type { Zero } from '@rocicorp/zero';
import { v4 as uuidv4 } from 'uuid';
import { formatDistanceToNow } from 'date-fns';
import { MessageType, parseForwardedMessageXml, type MessageAttachment } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { useAllVisibleChannels } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { mutators } from '@/src/zero/mutators';
import { subscribeMutationRestore } from '@/src/zero/awaitMutation';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';

import type { MessageForRender } from '../../message/message.types';
import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import { HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

import {
  applyForwardSelection,
  buildForwardTargetItems,
  canAddMoreTargets,
  getForwardRecipientIds,
  getSelectionMode,
  getTotalRecipientCount,
  type ForwardSearchListItem,
  type ForwardTarget,
  type SelectionMode,
} from './forward-targets';

export type { ForwardSearchListItem, ForwardTarget, SelectionMode } from './forward-targets';

export type ForwardMessageSheetTarget = MessageForRender & {
  channelId: string;
};

export type ForwardMessagePreviewAttachment = MessageAttachment;

const stripForwardedPreviewHtml = (html: string): string =>
  stripHtmlTags(html.replace(/<br\s*\/?>/gi, '\n'), HTML_TAG_OR_EMPTY)
    .replace(/&nbsp;/gi, ' ')
    .trim();

type UseForwardMessageViewModelArgs = {
  target: ForwardMessageSheetTarget;
  onClose: (afterDismiss?: () => void) => void;
  zero: Zero | null;
};

type ForwardMessageSheetUser = ReturnType<typeof useUsers>[number];

const TARGET_POPOVER_SELECT_BLUR_DELAY_MS = 150;
const TARGET_POPOVER_INTERACTION_WINDOW_MS = 250;

export type ForwardMessageViewModel = {
  inputRef: RefObject<TextInput | null>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  optionalMessage: string;
  setOptionalMessage: Dispatch<SetStateAction<string>>;
  selectedTargets: ForwardTarget[];
  selectionMode: SelectionMode;
  /** Group DM members plus selected users, counted against the 9-recipient cap. */
  totalRecipientCount: number;
  /** False once a channel is picked or the recipient cap is reached. */
  canAddMoreTargets: boolean;
  filteredItems: ForwardSearchListItem[];
  sender: ForwardMessageSheetUser | undefined;
  previewText: string;
  previewAttachments: readonly ForwardMessagePreviewAttachment[];
  previewAttachmentViewerItems: AttachmentsViewerItem[];
  previewSourceMessageId: string | undefined;
  relativeTime: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  isInputFocused: boolean;
  handleInputFocus: () => void;
  handleInputBlur: () => void;
  closeTargetsPopover: () => void;
  deferTargetsPopoverClose: () => void;
  handleSelectItem: (item: ForwardSearchListItem) => void;
  handleRemoveTarget: (targetId: string) => void;
  handleForward: () => Promise<void>;
};

export function useForwardMessageViewModel({
  target,
  onClose,
  zero,
}: UseForwardMessageViewModelArgs): ForwardMessageViewModel {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const inputRef = useRef<TextInput | null>(null);

  const [selectedTargets, setSelectedTargets] = useState<ForwardTarget[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [optionalMessage, setOptionalMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferBlurCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldDeferBlurCloseRef = useRef(false);

  const allVisibleChannels = useAllVisibleChannels();
  const allUsers = useUsers();

  const selectionMode: SelectionMode = useMemo(
    () => getSelectionMode(selectedTargets),
    [selectedTargets],
  );
  const totalRecipientCount = useMemo(
    () => getTotalRecipientCount(selectedTargets),
    [selectedTargets],
  );
  const canAddMore = useMemo(() => canAddMoreTargets(selectedTargets), [selectedTargets]);

  // A public channel may be readable without membership. Forwarding creates
  // content, so the target set comes from the joined-channel feed (which also
  // carries the user's DMs and group DMs) rather than the public directory.
  const filteredItems = useMemo(
    (): ForwardSearchListItem[] =>
      buildForwardTargetItems({
        channels: allVisibleChannels,
        users: allUsers,
        currentUserId: currentUser?.user_id ?? '',
        query: searchQuery,
        selectedTargets,
      }),
    [allVisibleChannels, allUsers, currentUser?.user_id, searchQuery, selectedTargets],
  );

  const clearBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current !== null) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  const clearDeferBlurClose = useCallback(() => {
    if (deferBlurCloseTimeoutRef.current !== null) {
      clearTimeout(deferBlurCloseTimeoutRef.current);
      deferBlurCloseTimeoutRef.current = null;
    }

    shouldDeferBlurCloseRef.current = false;
  }, []);

  const closeTargetsPopover = useCallback(() => {
    clearBlurTimeout();
    clearDeferBlurClose();

    setIsInputFocused(false);
  }, [clearBlurTimeout, clearDeferBlurClose]);

  const deferTargetsPopoverClose = useCallback(() => {
    shouldDeferBlurCloseRef.current = true;
    if (deferBlurCloseTimeoutRef.current !== null) {
      clearTimeout(deferBlurCloseTimeoutRef.current);
    }

    deferBlurCloseTimeoutRef.current = setTimeout(() => {
      shouldDeferBlurCloseRef.current = false;
      deferBlurCloseTimeoutRef.current = null;
    }, TARGET_POPOVER_INTERACTION_WINDOW_MS);
  }, []);

  const handleInputFocus = useCallback(() => {
    clearBlurTimeout();
    clearDeferBlurClose();
    setIsInputFocused(true);
  }, [clearBlurTimeout, clearDeferBlurClose]);

  const handleInputBlur = useCallback(() => {
    clearBlurTimeout();
    const shouldDeferClose = shouldDeferBlurCloseRef.current;
    clearDeferBlurClose();

    if (!shouldDeferClose) {
      closeTargetsPopover();
      return;
    }

    blurTimeoutRef.current = setTimeout(() => {
      setIsInputFocused(false);
      blurTimeoutRef.current = null;
    }, TARGET_POPOVER_SELECT_BLUR_DELAY_MS);
  }, [clearBlurTimeout, clearDeferBlurClose, closeTargetsPopover]);

  useEffect(() => {
    return (): void => {
      clearBlurTimeout();
      clearDeferBlurClose();
    };
  }, [clearBlurTimeout, clearDeferBlurClose]);

  const handleSelectItem = useCallback((item: ForwardSearchListItem) => {
    setSelectedTargets(prev => applyForwardSelection(prev, item));
    setSearchQuery('');
  }, []);

  const handleRemoveTarget = useCallback((targetId: string) => {
    setSelectedTargets(prev => prev.filter(t => t.id !== targetId));
  }, []);

  const senderId = target.initialMessage?.senderId;
  const sender = useMemo(() => {
    return allUsers.find(u => u.id === senderId);
  }, [allUsers, senderId]);

  const previewContent = useMemo(() => {
    const isForwardedMessage = target.initialMessage?.msgType === MessageType.FORWARDED;
    const content = target.initialMessage?.content ?? '';

    if (isForwardedMessage) {
      const parsed = parseForwardedMessageXml(content);
      if (parsed?.optionalText) {
        return parsed.optionalText;
      }
      return parsed?.content ?? content;
    }

    return content;
  }, [target.initialMessage?.content, target.initialMessage?.msgType]);

  const previewText = useMemo(() => {
    return stripForwardedPreviewHtml(previewContent);
  }, [previewContent]);

  const previewAttachments = useMemo<readonly ForwardMessagePreviewAttachment[]>(() => {
    return (target.initialMessage?.attachments ?? []).filter(attachment => !attachment.isDeleted);
  }, [target.initialMessage?.attachments]);

  const previewAttachmentViewerItems = useMemo<AttachmentsViewerItem[]>(
    () =>
      previewAttachments.map(attachment => ({
        id: attachment.id,
        mimetype: attachment.mimetype,
        originalFilename: attachment.originalFilename,
        size: attachment.size,
      })),
    [previewAttachments],
  );

  const closeThenNavigate = useCallback(
    (channelId: string, surface: 'channels' | 'dms'): void => {
      Keyboard.dismiss();
      // The sheet's after-dismiss callback is the navigation boundary. Waiting
      // on the native keyboard promise here can hang while the sheet is closing
      // and leave the forward action disabled indefinitely.
      void KeyboardController.dismiss();
      onClose(() => {
        const intent = createChatOpenIntent({ channelId, surface }, 'forward');
        if (intent) executeChatOpenIntent(router, intent);
      });
    },
    [onClose, router],
  );

  const handleForward = useCallback(async () => {
    if (selectedTargets.length === 0 || isSubmitting || !zero) return;

    const firstTarget = selectedTargets[0];
    if (!firstTarget) return;

    setIsSubmitting(true);

    try {
      if (firstTarget.type === 'channel') {
        const conversationId = uuidv4();
        const messageId = uuidv4();
        const timestamp = Date.now();

        const mutation = zero.mutate(
          mutators.conversations.forwardMessage({
            targetChannelId: firstTarget.id,
            originalMessageId: target.initialMessage?.messageId ?? '',
            optionalMessage: optionalMessage.trim() || undefined,
            conversationId,
            messageId,
            timestamp,
            conversationParticipantId: uuidv4(),
          }),
        );
        const clientResult = await mutation.client;
        if (clientResult.type === 'error') {
          const isTransient =
            !!clientResult.error &&
            typeof clientResult.error === 'object' &&
            'type' in clientResult.error &&
            clientResult.error.type === 'zero';
          if (!isTransient) {
            const message =
              clientResult.error &&
              typeof clientResult.error === 'object' &&
              'message' in clientResult.error &&
              typeof clientResult.error.message === 'string'
                ? clientResult.error.message
                : 'Please try again.';
            throw new Error(message);
          }
        }
        subscribeMutationRestore(mutation, () => {
          Alert.alert('Failed to forward message', 'Please try again.');
        });

        closeThenNavigate(firstTarget.id, 'channels');
      } else {
        // A group DM is re-resolved from its members (+ any extra users) so the
        // backend reuses the group DM with exactly that member set — same as web.
        const userIds = getForwardRecipientIds(selectedTargets);

        const { ChannelService } = await import('@/src/services/ChannelService');
        const channelService = new ChannelService();

        const forwardedMessagePayload: { originalMessageId: string; optionalMessage?: string } = {
          originalMessageId: target.initialMessage?.messageId ?? '',
        };
        const trimmedOptionalMessage = optionalMessage.trim();
        if (trimmedOptionalMessage) {
          forwardedMessagePayload.optionalMessage = trimmedOptionalMessage;
        }

        const dmResponse = await channelService.createDm({
          participantIds: userIds,
          forwardedMessage: forwardedMessagePayload,
        });

        closeThenNavigate(dmResponse.id, 'dms');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert('Failed to forward message', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [target, selectedTargets, optionalMessage, isSubmitting, zero, closeThenNavigate]);

  const canSubmit = selectedTargets.length > 0 && !isSubmitting;
  const relativeTime = target.initialMessage?.createdAt
    ? formatDistanceToNow(target.initialMessage.createdAt, { addSuffix: true })
    : '';

  return {
    inputRef,
    searchQuery,
    setSearchQuery,
    optionalMessage,
    setOptionalMessage,
    selectedTargets,
    selectionMode,
    totalRecipientCount,
    canAddMoreTargets: canAddMore,
    filteredItems,
    sender,
    previewText,
    previewAttachments,
    previewAttachmentViewerItems,
    previewSourceMessageId: target.initialMessage?.messageId,
    relativeTime,
    canSubmit,
    isSubmitting,
    isInputFocused,
    handleInputFocus,
    handleInputBlur,
    closeTargetsPopover,
    deferTargetsPopoverClose,
    handleSelectItem,
    handleRemoveTarget,
    handleForward,
  };
}
