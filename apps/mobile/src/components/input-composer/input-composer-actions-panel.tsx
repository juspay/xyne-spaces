import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import { ChatInput } from './input-composer';
import clsx from 'clsx';

const ActionsComponent = ({ className }: { className?: string }): ReactElement | null => {
  return (
    <View className={clsx(className, 'flex-row items-center')}>
      <ChatInput.FormatAction />
      <ChatInput.EmojiAction />
    </View>
  );
};
const Actions = memo(ActionsComponent);
Actions.displayName = 'ChatInput.Actions';

export { Actions };
