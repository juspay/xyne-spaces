import { useMemo } from 'react';
import { useDialKit, type DialConfig } from 'dialkit';
import type { Transition } from 'motion/react';
import { DRAFT_CHAT_EASE_OUT } from './draftChatMotion';

export const DRAFT_CHAT_MOTION_DIAL_ID = 'draft-chat-motion';

/**
 * The test chat card rising out from behind the composer, and folding back,
 * as tuned on the DialKit panel.
 *
 * Open: a quick spring with a little bounce, so the card lands with a slight
 * settle. Fold: Granola's quick ease-out over 200ms.
 *
 * In dev both sit on the DialKit panel ("Test chat motion") to play with.
 */
const DRAFT_CHAT_MOTION_DIAL = {
  open: { type: 'spring', visualDuration: 0.2, bounce: 0.2 },
  fold: {
    type: 'easing',
    duration: 0.2,
    ease: [
      DRAFT_CHAT_EASE_OUT[0],
      DRAFT_CHAT_EASE_OUT[1],
      DRAFT_CHAT_EASE_OUT[2],
      DRAFT_CHAT_EASE_OUT[3],
    ],
  },
} as const satisfies DialConfig;

type DialTransition = ReturnType<typeof useMotionDial>['open'];

export interface DraftChatMotion {
  open: Transition;
  fold: Transition;
}

function toMotion(config: DialTransition): Transition {
  if (config.type === 'easing') {
    return { type: 'tween', duration: config.duration, ease: [...config.ease] };
  }
  const { type: _type, ...spring } = config;
  // The animated value runs 0-1 across the whole panel, so the default rest
  // distance (0.01) would end it with a few px jump.
  return { type: 'spring', restDelta: 0.001, restSpeed: 0.01, ...spring };
}

const DEFAULTS: DraftChatMotion = {
  open: toMotion(DRAFT_CHAT_MOTION_DIAL.open),
  fold: toMotion(DRAFT_CHAT_MOTION_DIAL.fold),
};

function useMotionDial(): ReturnType<typeof useDialKit<typeof DRAFT_CHAT_MOTION_DIAL>> {
  // Tuned values and the version picked survive a reload.
  return useDialKit('Test chat motion', DRAFT_CHAT_MOTION_DIAL, {
    id: DRAFT_CHAT_MOTION_DIAL_ID,
    persist: true,
  });
}

function useDialledMotion(): DraftChatMotion {
  const dial = useMotionDial();
  return useMemo(() => ({ open: toMotion(dial.open), fold: toMotion(dial.fold) }), [dial]);
}

export const useDraftChatMotion: () => DraftChatMotion = import.meta.env.DEV
  ? useDialledMotion
  : (): DraftChatMotion => DEFAULTS;
