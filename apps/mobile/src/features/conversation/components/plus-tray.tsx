import { useCallback, useRef, type ReactElement } from 'react';
import { Platform } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useConnectionState } from '@rocicorp/zero/react';
import { useCSSVariable } from 'uniwind';

import {
  useChatInputConversation,
  useChatInputHandlers,
  useChatInputText,
} from '@/src/components/input-composer';
import { useComposerAttachmentPicking } from '@/src/components/input-composer/hooks/useComposerAttachmentPicking';
import {
  pickFromCamera,
  pickFromFiles,
  pickFromGallery,
} from '@/src/components/input-composer/utils/composer-attachments-picker';

import {
  plusTrayExitFocus,
  plusTraySections,
  type PlusTrayExit,
  type PlusTrayRowId,
} from '../model/plus-tray';
import { colorOf } from '../model/token-color';
import { PlusTrayRowButton } from './plus-tray-row';
import { TrayCard, TrayCardSection, useTrayCardMotion } from './tray-card';

type PlusTrayProps = {
  /** The tray put the keyboard away as it opened, keeping the field's focus. */
  heldKeyboard: boolean;
  /** The tray has animated away and can unmount. */
  onClosed: () => void;
};

/**
 * The "+" tray (Figma "Plus tray"): a card floating over the screen and the
 * typing bar on a scrim, wired to the composer's own pickers and schedule
 * picker. It slides up as the scrim fades in; the scrim, the close plate,
 * back, Escape or a drag down put it away again.
 */
export function PlusTray({ heldKeyboard, onClosed }: PlusTrayProps): ReactElement {
  const { isEditing, isTwinEditing } = useChatInputConversation();
  const { canSend } = useChatInputText();
  // Read straight from Zero: the shared offline hook only flips on a change
  // after it mounts, and the tray mounts mid-outage while Zero is reconnecting.
  const offline = useConnectionState().name !== 'connected';
  const { inputRef, openSchedule } = useChatInputHandlers();
  const [foregroundToken, subtleToken] = useCSSVariable([
    '--color-spaces-foreground',
    '--color-spaces-subtle',
  ]);
  const iconColor = colorOf(foregroundToken);
  const lowestColor = colorOf(subtleToken);

  const motion = useTrayCardMotion();
  const closing = useRef<Promise<void> | null>(null);

  const close = useCallback(
    (exit: PlusTrayExit): Promise<void> => {
      if (closing.current !== null) return closing.current;
      const focus = plusTrayExitFocus(heldKeyboard, exit);
      if (focus === 'release') inputRef.current?.blur();
      closing.current = new Promise<void>(resolve => {
        const finish = (): void => {
          onClosed();
          // iOS kept the field focused under an empty input view, which only the library puts back.
          if (focus === 'restore' && Platform.OS === 'ios')
            KeyboardController.setFocusTo('current');
          else if (focus === 'restore') inputRef.current?.focus();
          resolve();
        };
        void motion.hide().then(finish);
      });
      return closing.current;
    },
    [heldKeyboard, inputRef, motion, onClosed],
  );

  const dismiss = useCallback((): void => void close('dismiss'), [close]);
  const handOff = useCallback((): Promise<void> => close('handoff'), [close]);
  const { pick, isPicking, remainingSlots } = useComposerAttachmentPicking(handOff);

  const sections = plusTraySections({
    attachmentSlotsLeft: remainingSlots,
    picking: isPicking,
    canSchedule: canSend && !isEditing && !isTwinEditing,
    offline,
  });

  const run = (id: PlusTrayRowId): void => {
    // Rows stay on screen while the tray slides away; only the first choice counts.
    if (closing.current !== null) return;
    switch (id) {
      case 'photos':
        void pick(pickFromGallery);
        return;
      case 'camera':
        void pick(pickFromCamera);
        return;
      case 'files':
        void pick(pickFromFiles);
        return;
      case 'schedule':
        void handOff().then(openSchedule);
        return;
    }
  };

  return (
    <TrayCard motion={motion} title='Add to conversation' onDismiss={dismiss}>
      {sections.map((section, index) => (
        <TrayCardSection key={section.id} last={index === sections.length - 1}>
          {section.rows.map(row => (
            <PlusTrayRowButton
              key={row.id}
              row={row}
              iconColor={iconColor}
              lowestColor={lowestColor}
              onPress={run}
            />
          ))}
        </TrayCardSection>
      ))}
    </TrayCard>
  );
}
