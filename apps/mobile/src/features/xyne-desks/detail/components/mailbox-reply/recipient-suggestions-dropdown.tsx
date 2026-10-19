import { memo, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getMailboxRecipientColor, getMailboxRecipientInitial } from './mailbox-reply.utils';
import {
  RECIPIENT_SUGGESTION_SOURCE_LABEL,
  type RecipientSuggestion,
} from './mailbox-reply.suggestions';

const SUGGESTION_LIST_MAX_HEIGHT = 240;

type RecipientSuggestionsDropdownProps = {
  suggestions: readonly RecipientSuggestion[];
  onSelect: (suggestion: RecipientSuggestion) => void;
};

export const RecipientSuggestionsDropdown = memo(function RecipientSuggestionsDropdown({
  suggestions,
  onSelect,
}: RecipientSuggestionsDropdownProps): ReactElement | null {
  if (suggestions.length === 0) return null;

  return (
    <ScrollView
      nestedScrollEnabled
      keyboardShouldPersistTaps='handled'
      style={{ maxHeight: SUGGESTION_LIST_MAX_HEIGHT }}
      className='border-b border-foreground/15 bg-neutral-100 dark:bg-tabs-screen'
    >
      {suggestions.map(suggestion => (
        <SuggestionRow
          key={`${suggestion.source}:${suggestion.email}`}
          suggestion={suggestion}
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
});

const SuggestionRow = memo(function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: RecipientSuggestion;
  onSelect: (suggestion: RecipientSuggestion) => void;
}): ReactElement {
  const initial = getMailboxRecipientInitial({
    id: suggestion.email,
    email: suggestion.email,
    name: suggestion.name ?? '',
  });
  const avatarBg = getMailboxRecipientColor(suggestion.email);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`${suggestion.name ?? suggestion.email}, ${suggestion.email}`}
      onPress={() => onSelect(suggestion)}
      className='flex-row items-center gap-3 px-4 py-2.5 active:bg-foreground/5'
    >
      <View
        className='size-8 items-center justify-center'
        style={{ backgroundColor: avatarBg, borderRadius: 6 }}
      >
        <Text className='text-[14px] font-medium text-white'>{initial}</Text>
      </View>

      <View className='min-w-0 flex-1'>
        {suggestion.name ? (
          <Text className='text-[15px] font-medium text-foreground' numberOfLines={1}>
            {suggestion.name}
          </Text>
        ) : null}
        <Text className='text-[13px] text-foreground/60' numberOfLines={1}>
          {suggestion.email}
        </Text>
      </View>

      <Text className='text-[12px] text-foreground/45'>
        {RECIPIENT_SUGGESTION_SOURCE_LABEL[suggestion.source]}
      </Text>
    </Pressable>
  );
});
