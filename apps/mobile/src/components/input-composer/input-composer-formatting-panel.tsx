import { memo, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { useChatInputPanelState } from './input-composer-context';
import { ChatInput } from './input-composer';
import { FORMAT_BUTTONS, FormatButton } from './input-composer-format-button';
import { cn } from '@/src/utils/cn';

type FormattingPanelProps = {
  className?: string;
};

const FormattingPanelComponent = ({ className }: FormattingPanelProps): ReactElement | null => {
  const { isFormattingVisible } = useChatInputPanelState();

  if (!isFormattingVisible) {
    return null;
  }

  return (
    <View
      className={cn('h-auto max-h-10', className)}
      pointerEvents={isFormattingVisible ? 'auto' : 'none'}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        {...(className !== undefined ? { className } : {})}
        contentContainerClassName='flex-row items-center gap-5'
      >
        {FORMAT_BUTTONS.map(config => (
          <FormatButton key={config.id} config={config} />
        ))}
        <ChatInput.FormatDivider />
        <ChatInput.CloseFormat />
      </ScrollView>
    </View>
  );
};
const FormattingPanel = memo(FormattingPanelComponent);

FormattingPanel.displayName = 'ChatInput.FormattingPanel';

export { FormattingPanel };
