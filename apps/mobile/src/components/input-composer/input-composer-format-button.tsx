import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  Underline,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Pressable } from 'react-native';
import type { OnChangeStateEvent } from 'react-native-enriched';
import { useCSSVariable } from 'uniwind';

import {
  useChatInputActions,
  useChatInputHandlers,
  useChatInputRichState,
} from './input-composer-context';
import { FORMAT_BUTTON_CLASS, type ChatInputFormatProps } from './input-composer-format-shared';

type FormatButtonConfig = {
  id: string;
  Icon: LucideIcon;
  activeKey: keyof OnChangeStateEvent;
  accessibilityLabel: string;
  onPress: (args: {
    input: NonNullable<ReturnType<typeof useChatInputHandlers>['inputRef']['current']>;
    selection: ReturnType<typeof useChatInputRichState>['selection'];
    openLinkModal: ReturnType<typeof useChatInputActions>['openLinkModal'];
  }) => void;
};

const FORMAT_BUTTONS: readonly FormatButtonConfig[] = [
  {
    id: 'bold',
    Icon: Bold,
    activeKey: 'bold',
    accessibilityLabel: 'Toggle bold',
    onPress: ({ input }) => input.toggleBold(),
  },
  {
    id: 'italic',
    Icon: Italic,
    activeKey: 'italic',
    accessibilityLabel: 'Toggle italic',
    onPress: ({ input }) => input.toggleItalic(),
  },
  {
    id: 'underline',
    Icon: Underline,
    activeKey: 'underline',
    accessibilityLabel: 'Toggle underline',
    onPress: ({ input }) => input.toggleUnderline(),
  },
  {
    id: 'strike-through',
    Icon: Strikethrough,
    activeKey: 'strikeThrough',
    accessibilityLabel: 'Toggle strike through',
    onPress: ({ input }) => input.toggleStrikeThrough(),
  },
  {
    id: 'link',
    Icon: Link2,
    activeKey: 'link',
    accessibilityLabel: 'Set link',
    onPress: ({ openLinkModal, selection }) => openLinkModal(selection),
  },
  {
    id: 'ordered-list',
    Icon: ListOrdered,
    activeKey: 'orderedList',
    accessibilityLabel: 'Toggle ordered list',
    onPress: ({ input }) => input.toggleOrderedList(),
  },
  {
    id: 'unordered-list',
    Icon: List,
    activeKey: 'unorderedList',
    accessibilityLabel: 'Toggle unordered list',
    onPress: ({ input }) => input.toggleUnorderedList(),
  },
  {
    id: 'block-quote',
    Icon: Quote,
    activeKey: 'blockQuote',
    accessibilityLabel: 'Toggle block quote',
    onPress: ({ input }) => input.toggleBlockQuote(),
  },
  {
    id: 'inline-code',
    Icon: Code,
    activeKey: 'inlineCode',
    accessibilityLabel: 'Toggle inline code',
    onPress: ({ input }) => input.toggleInlineCode(),
  },
  {
    id: 'code-block',
    Icon: SquareCode,
    activeKey: 'codeBlock',
    accessibilityLabel: 'Toggle code block',
    onPress: ({ input }) => input.toggleCodeBlock(),
  },
];

const FormatButtonComponent = ({
  config,
  className,
}: ChatInputFormatProps & { config: FormatButtonConfig }): ReactElement => {
  const { styleState, selection } = useChatInputRichState();
  const { inputRef } = useChatInputHandlers();
  const { openLinkModal } = useChatInputActions();
  const activeColor = useCSSVariable('--color-action-primary') as string;
  const inactiveColor = useCSSVariable('--color-secondary-foreground') as string;
  const activeState = styleState?.[config.activeKey] as { isActive?: boolean } | undefined;

  return (
    <Pressable
      onPress={() => {
        const input = inputRef.current;
        if (!input) return;
        config.onPress({ input, selection, openLinkModal });
      }}
      accessibilityRole='button'
      accessibilityLabel={config.accessibilityLabel}
      className={className ?? FORMAT_BUTTON_CLASS}
    >
      <config.Icon size={18} color={activeState?.isActive ? activeColor : inactiveColor} />
    </Pressable>
  );
};
const FormatButton = memo(FormatButtonComponent);

FormatButton.displayName = 'ChatInput.FormatButton';

export { FORMAT_BUTTONS, FormatButton };
