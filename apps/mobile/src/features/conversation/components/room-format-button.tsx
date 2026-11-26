import { memo, useCallback, type ReactElement } from 'react';

import {
  useChatInputActions,
  useChatInputHandlers,
  useChatInputRichState,
} from '@/src/components/input-composer';
import { FORMAT_BUTTONS } from '@/src/components/input-composer/input-composer-format-button';

import { TYPING_BAR_ICON_SIZE, TYPING_BAR_TOOL_HIT_SLOP, TYPING_BAR_TOOL_SIZE } from '../constants';
import { IconButton } from './icon-button';

type RoomFormatButtonProps = {
  config: (typeof FORMAT_BUTTONS)[number];
  activeColor: string;
  inactiveColor: string;
  disabled: boolean;
};

/** One style in the formatting strip, in the active colour while the caret is inside it. */
function RoomFormatButtonComponent({
  config,
  activeColor,
  inactiveColor,
  disabled,
}: RoomFormatButtonProps): ReactElement {
  const { styleState, selection } = useChatInputRichState();
  const { inputRef } = useChatInputHandlers();
  const { openLinkModal } = useChatInputActions();
  const active =
    (styleState?.[config.activeKey] as { isActive?: boolean } | undefined)?.isActive === true;

  const press = useCallback((): void => {
    const input = inputRef.current;
    if (!input) return;
    config.onPress({ input, selection, openLinkModal });
  }, [config, inputRef, openLinkModal, selection]);

  return (
    <IconButton
      label={config.accessibilityLabel}
      size={TYPING_BAR_TOOL_SIZE}
      hitSlop={TYPING_BAR_TOOL_HIT_SLOP}
      selected={active}
      disabled={disabled}
      onPress={press}
    >
      <config.Icon size={TYPING_BAR_ICON_SIZE} color={active ? activeColor : inactiveColor} />
    </IconButton>
  );
}

export const RoomFormatButton = memo(RoomFormatButtonComponent);
RoomFormatButton.displayName = 'RoomFormatButton';
