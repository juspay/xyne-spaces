import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMentionSearch, type MentionResult } from '@xyne/shared/hooks';

import {
  useChatInputActions,
  useChatInputConversation,
  useChatInputHandlers,
  useChatInputMentionState,
} from '../input-composer-context';
import {
  buildChannelMentionAttributes,
  buildGroupMentionAttributes,
  buildSpecialMentionAttributes,
  buildUserMentionAttributes,
  closeMentionPicker,
  toMentionChannels,
  toMentionItems,
  type MentionListItem,
  type MentionUserOption,
} from '../utils/mentions';
import { useAllChannels } from '@/src/hooks/useChannels';
import { useSelf } from '@/src/hooks/useUsers';
import { SELF_MENTION_INDICATOR } from '@/src/utils/mention-indicator';

const MENTION_SEARCH_DEBOUNCE_MS = 150;

const mentionResultToUserOption = (r: MentionResult): MentionUserOption => {
  if (r.isSpecial && (r.type === 'channel' || r.type === 'here')) {
    return {
      id: r.id,
      name: r.name,
      type: 'special',
      mentionType: r.type,
      ...(r.description && { description: r.description }),
    };
  }
  if (r.type === 'group') {
    return {
      id: r.id,
      name: r.name,
      type: 'group',
      ...(r.alias && { alias: r.alias }),
      ...(r.description && { description: r.description }),
    };
  }
  return {
    id: r.id,
    name: r.name,
    type: 'user',
    ...(r.picture && { avatar: r.picture }),
    ...(r.email && { email: r.email }),
  };
};

const useInputComposerMentions = (): {
  isMentionOpen: boolean;
  isChannelMode: boolean;
  items: MentionListItem[];
  onSelectItem: (item: MentionListItem) => void;
} => {
  const { conversationId } = useChatInputConversation();
  const { isMentionOpen, mentionQuery, mentionMode } = useChatInputMentionState();
  const { setIsMentionOpenState, setMentionQueryState } = useChatInputActions();
  const { inputRef } = useChatInputHandlers();

  const channels = useAllChannels();
  const self = useSelf();
  const [debouncedMentionQuery, setDebouncedMentionQuery] = useState(mentionQuery);
  const normalizedQuery = debouncedMentionQuery.trim().toLowerCase();

  const { results: mentionResults, searchMentions } = useMentionSearch(conversationId, self?.id);

  useEffect(() => {
    if (!isMentionOpen || mentionQuery.length <= 1) {
      setDebouncedMentionQuery(mentionQuery);
      return;
    }

    const timeout = setTimeout(() => {
      setDebouncedMentionQuery(mentionQuery);
    }, MENTION_SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timeout);
  }, [isMentionOpen, mentionQuery]);

  useEffect(() => {
    if (!isMentionOpen) return;
    searchMentions(debouncedMentionQuery);
  }, [debouncedMentionQuery, isMentionOpen, searchMentions]);

  const mentionUsers = useMemo(
    () => mentionResults.map(mentionResultToUserOption),
    [mentionResults],
  );
  const mentionChannels = useMemo(
    () => toMentionChannels(channels, normalizedQuery),
    [channels, normalizedQuery],
  );

  const items = useMemo(() => {
    if (!isMentionOpen) return [];
    return toMentionItems(mentionMode, mentionUsers, mentionChannels);
  }, [isMentionOpen, mentionChannels, mentionMode, mentionUsers]);
  const isChannelMode = mentionMode === '#';

  const onSelectItem = useCallback(
    (item: MentionListItem): void => {
      if (item.type === 'channel') {
        const channelPrefix = item.isPrivate ? '🔒' : '#';
        inputRef.current?.setMention(
          '#',
          `${channelPrefix}${item.name}`,
          buildChannelMentionAttributes(item),
        );
        closeMentionPicker(setIsMentionOpenState, setMentionQueryState);
        return;
      }

      if (item.type === 'special' && item.mentionType) {
        inputRef.current?.setMention(
          '@',
          `@${item.mentionType}`,
          buildSpecialMentionAttributes(item.mentionType),
        );
        closeMentionPicker(setIsMentionOpenState, setMentionQueryState);
        return;
      }

      if (item.type === 'group') {
        const groupName = item.alias || item.name;
        inputRef.current?.setMention('@', `@${groupName}`, buildGroupMentionAttributes(item));
        closeMentionPicker(setIsMentionOpenState, setMentionQueryState);
        return;
      }

      const userItem: MentionUserOption = item;
      const indicator = userItem.id === self?.id ? SELF_MENTION_INDICATOR : '@';
      inputRef.current?.setMention(
        indicator,
        `@${userItem.name}`,
        buildUserMentionAttributes(userItem),
      );
      closeMentionPicker(setIsMentionOpenState, setMentionQueryState);
    },
    [inputRef, self?.id, setIsMentionOpenState, setMentionQueryState],
  );

  return { isMentionOpen, isChannelMode, items, onSelectItem };
};

export { useInputComposerMentions };
