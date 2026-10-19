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
import {
  ChannelScopeType,
  ChannelVisibility,
  MessageType,
  parseForwardedMessageXml,
  type MessageAttachment,
} from '@xyne/shared';

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

export type ForwardTarget = {
  type: 'channel' | 'user';
  id: string;
  name: string;
};

export type SelectionMode = 'none' | 'channel' | 'users';

export type ForwardMessageSheetTarget = MessageForRender & {
  channelId: string;
};

export type ForwardMessagePreviewAttachment = MessageAttachment;

const stripForwardedPreviewHtml = (html: string): string =>
  stripHtmlTags(html.replace(/<br\s*\/?>/gi, '\n'), HTML_TAG_OR_EMPTY)
    .replace(/&nbsp;/gi, ' ')
    .trim();

export type ForwardSearchListItem = {
  id: string;
  type: 'channel' | 'user';
  name: string;
  description?: string;
  isPrivate?: boolean;
  picture?: string;
};

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

  const selectionMode: SelectionMode = useMemo(() => {
    if (selectedTargets.length === 0) return 'none';
    const firstTarget = selectedTargets[0];
    if (firstTarget && firstTarget.type === 'channel') return 'channel';
    return 'users';
  }, [selectedTargets]);

  const selectedUserIds = useMemo(() => {
    return new Set(selectedTargets.filter(t => t.type === 'user').map(t => t.id));
  }, [selectedTargets]);

  const searchItems = useMemo((): ForwardSearchListItem[] => {
    const items: ForwardSearchListItem[] = [];

    // A public channel may be readable without membership. Forwarding creates
    // content, so its target set must match the joined-channel feed rather
    // than the public directory.
    allVisibleChannels
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .forEach(channel => {
        const item: ForwardSearchListItem = {
          id: channel.id,
          type: 'channel',
          name: channel.name,
          isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
        };
        if (channel.description) {
          item.description = channel.description;
        }
        items.push(item);
      });

    allUsers.forEach(user => {
      if (user.id !== currentUser?.user_id) {
        const item: ForwardSearchListItem = {
          id: user.id,
          type: 'user',
          name: user.name,
          description: user.email,
        };
        if (user.picture) {
          item.picture = user.picture;
        }
        items.push(item);
      }
    });

    return items;
  }, [allVisibleChannels, allUsers, currentUser?.user_id]);

  const filteredItems = useMemo((): ForwardSearchListItem[] => {
    const query = searchQuery.toLowerCase().trim();

    let items = searchItems;

    if (selectionMode === 'channel') {
      items = items.filter(item => item.type === 'channel');
    } else if (selectionMode === 'users') {
      items = items.filter(item => item.type === 'user' && !selectedUserIds.has(item.id));
    }

    if (query) {
      items = items.filter(
        item =>
          item.name.toLowerCase().includes(query) ||
          (item.description?.toLowerCase().includes(query) ?? false),
      );
    }

    if (selectionMode === 'none' && !query) {
      const recentChannels = allVisibleChannels
        .filter(c => c.scopeType === ChannelScopeType.DEFAULT)
        .sort(
          (a, b) => (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0),
        )
        .slice(0, 5)
        .map(c => c.id);

      items.sort((a, b) => {
        const aIsRecent = a.type === 'channel' && recentChannels.includes(a.id);
        const bIsRecent = b.type === 'channel' && recentChannels.includes(b.id);
        if (aIsRecent && !bIsRecent) return -1;
        if (!aIsRecent && bIsRecent) return 1;

        if (a.type === 'user' && b.type === 'channel') return -1;
        if (a.type === 'channel' && b.type === 'user') return 1;

        return a.name.localeCompare(b.name);
      });
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }

    return items.slice(0, 20);
  }, [searchItems, searchQuery, selectionMode, selectedUserIds, allVisibleChannels]);

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

  const handleSelectItem = useCallback(
    (item: ForwardSearchListItem) => {
      const selectedTarget: ForwardTarget = {
        type: item.type,
        id: item.id,
        name: item.name,
      };

      if (item.type === 'channel') {
        setSelectedTargets([selectedTarget]);
      } else if (!selectedUserIds.has(item.id)) {
        setSelectedTargets(prev => [...prev, selectedTarget]);
      }

      setSearchQuery('');
    },
    [selectedUserIds],
  );

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
        const userIds = selectedTargets.map(t => t.id);

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
