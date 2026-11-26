import type { TrayRow } from './tray-card';

export type PlusTrayRowId = 'photos' | 'camera' | 'files' | 'schedule';

export type PlusTrayRow = TrayRow<PlusTrayRowId>;

type PlusTraySection = Readonly<{
  id: 'attach' | 'compose';
  rows: readonly PlusTrayRow[];
}>;

export type PlusTrayComposer = Readonly<{
  attachmentSlotsLeft: number;
  picking: boolean;
  canSchedule: boolean;
  /** Scheduling needs the server, as sending does. */
  offline: boolean;
}>;

const ATTACHMENT_LIMIT_SUBTITLE = 'Attachment limit reached';

function scheduleSubtitle({ offline, canSchedule }: PlusTrayComposer): string {
  if (offline) return "You're offline";
  return canSchedule ? 'Choose when it sends' : 'Write a message first';
}

/**
 * The tray's rows, in two cards: what can be attached, then when the message
 * goes. Attaching is off while a picker is open or no slot is left;
 * scheduling needs something to send and a connection, as the send
 * long-press does.
 */
export function plusTraySections(state: PlusTrayComposer): readonly PlusTraySection[] {
  const attachDisabled = state.picking || state.attachmentSlotsLeft === 0;
  const attachSubtitle = state.attachmentSlotsLeft === 0 ? ATTACHMENT_LIMIT_SUBTITLE : null;

  return [
    {
      id: 'attach',
      rows: [
        {
          id: 'photos',
          title: 'Photos',
          subtitle: attachSubtitle ?? 'Photos and videos from your library',
          disabled: attachDisabled,
        },
        { id: 'camera', title: 'Camera', subtitle: attachSubtitle, disabled: attachDisabled },
        { id: 'files', title: 'Files', subtitle: attachSubtitle, disabled: attachDisabled },
      ],
    },
    {
      id: 'compose',
      rows: [
        {
          id: 'schedule',
          title: 'Schedule message',
          subtitle: scheduleSubtitle(state),
          disabled: state.offline || !state.canSchedule,
        },
      ],
    },
  ];
}

/**
 * The tray is open or closed; open, it remembers whether it put the keyboard
 * away, so that closing can bring it back.
 */
export type PlusTrayState =
  Readonly<{ open: false }> | Readonly<{ open: true; heldKeyboard: boolean }>;

export const PLUS_TRAY_CLOSED: PlusTrayState = { open: false };

export function openPlusTray(keyboardVisible: boolean): PlusTrayState {
  return { open: true, heldKeyboard: keyboardVisible };
}

/**
 * How the tray closes: put away (scrim, close, back, swipe), or handed to a
 * picker or the schedule sheet.
 */
export type PlusTrayExit = 'dismiss' | 'handoff';

/**
 * What a closing tray does with the field. `restore` brings back the keyboard
 * it held, `release` lets go of a held focus for a surface that takes over
 * (and refocuses the field itself), `none` leaves it.
 */
type PlusTrayFocus = 'restore' | 'release' | 'none';

export function plusTrayExitFocus(heldKeyboard: boolean, exit: PlusTrayExit): PlusTrayFocus {
  switch (exit) {
    case 'dismiss':
      return heldKeyboard ? 'restore' : 'none';
    case 'handoff':
      return heldKeyboard ? 'release' : 'none';
  }
}
