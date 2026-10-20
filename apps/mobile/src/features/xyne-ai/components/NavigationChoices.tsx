import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import {
  MentionChannelRow,
  MentionPanel,
  MentionUserRow,
} from '@/src/components/input-composer/mention-rows';

import type { NavigationChoices as Choices } from '../hooks/useXyneAINavigation';

/** Asks which of several matches a command meant, with a way out to Xyne AI. */
export const NavigationChoices = ({
  choices,
  onPick,
  onAskAI,
}: {
  choices: Choices;
  onPick: (id: string) => void;
  onAskAI: (text: string) => void;
}): ReactElement => (
  <MentionPanel>
    <Text className='px-4 pb-1 pt-3 text-xs font-medium text-secondary-foreground'>Which one?</Text>
    <ScrollView
      style={{ maxHeight: 200 }}
      keyboardShouldPersistTaps='handled'
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
    >
      {choices.items.map(item => {
        switch (item.type) {
          case 'action':
            return (
              <Pressable
                key={item.id}
                accessibilityRole='button'
                onPress={(): void => onPick(item.id)}
                className='px-4 py-3 active:bg-accent'
              >
                <Text className='text-sm text-foreground'>{item.title}</Text>
              </Pressable>
            );
          case 'channel':
            return (
              <MentionChannelRow
                key={item.id}
                item={item}
                onSelectItem={({ id }): void => onPick(id)}
              />
            );
          default:
            return (
              <MentionUserRow
                key={item.id}
                item={item}
                onSelectItem={({ id }): void => onPick(id)}
              />
            );
        }
      })}
    </ScrollView>
    <Pressable
      accessibilityRole='button'
      onPress={(): void => onAskAI(choices.text)}
      className='px-4 py-3 active:bg-accent'
    >
      <Text className='text-sm text-secondary-foreground'>Ask Xyne AI instead</Text>
    </Pressable>
  </MentionPanel>
);
