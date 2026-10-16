import { LegendList } from '@legendapp/list/react-native';
import { memo, useCallback, type ReactElement } from 'react';

import { useInputComposerMentions } from './hooks/useInputComposerMentions';
import { useChatInputMentionState } from './input-composer-context';
import { MentionChannelRow, MentionEmpty, MentionPanel, MentionUserRow } from './mention-rows';
import type { MentionChannelOption, MentionListItem, MentionUserOption } from './utils/mentions';

type MentionsProps = {
  className?: string;
};

const OpenMentionsList = ({ className }: MentionsProps): ReactElement => {
  const { isChannelMode, items, onSelectItem } = useInputComposerMentions();

  const renderItem = useCallback(
    ({ item }: { item: MentionListItem }): ReactElement =>
      item.type === 'channel' ? (
        <MentionChannelRow item={item} onSelectItem={onSelectItem} />
      ) : (
        <MentionUserRow item={item} onSelectItem={onSelectItem} />
      ),
    [onSelectItem],
  );

  return (
    <MentionPanel {...(className !== undefined ? { className } : {})}>
      <LegendList
        style={{ maxHeight: 200 }}
        data={items}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps='handled'
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        renderItem={renderItem}
        ListEmptyComponent={
          <MentionEmpty label={isChannelMode ? 'No channels found' : 'No people found'} />
        }
      />
    </MentionPanel>
  );
};

const MentionsListComponent = ({ className }: MentionsProps): ReactElement | null => {
  const { isMentionOpen } = useChatInputMentionState();
  if (!isMentionOpen) return null;
  return <OpenMentionsList {...(className !== undefined ? { className } : {})} />;
};

export const MentionsList = memo(MentionsListComponent);

export type { MentionUserOption, MentionChannelOption };
MentionsList.displayName = 'ChatInput.MentionsList';
