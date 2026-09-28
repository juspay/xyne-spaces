import { useEffect, useRef } from 'react';

/** Holding Space this long starts talking; a quicker tap does nothing. */
const HOLD_DELAY_MS = 200;

/** The orb (`data-voice-orb`): the one control where Space means "talk" rather than "click". */
const ORB = '[data-voice-orb]';

/**
 * Hold Space to talk, release to send, like a walkie-talkie. Ignored while typing or when
 * another control has focus, since Space already means something there.
 */
export function useSpaceToTalk({
  onPress,
  onRelease,
}: {
  onPress: () => void;
  onRelease: () => void;
}): void {
  const handlersRef = useRef({ onPress, onRelease });
  useEffect(() => {
    handlersRef.current = { onPress, onRelease };
  }, [onPress, onRelease]);

  useEffect(() => {
    let holdTimer: number | null = null;
    let talking = false;

    const stop = (): void => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      holdTimer = null;
      if (talking) handlersRef.current.onRelease();
      talking = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || spaceHasOtherMeaning(event.target)) return;
      event.preventDefault(); // no page scroll while holding
      if (event.repeat || holdTimer !== null || talking) return;
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        talking = true;
        handlersRef.current.onPress();
      }, HOLD_DELAY_MS);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || (holdTimer === null && !talking)) return;
      event.preventDefault();
      stop();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // Switching windows mid-hold never delivers the keyup.
    window.addEventListener('blur', stop);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stop);
      if (holdTimer !== null) window.clearTimeout(holdTimer);
    };
  }, []);
}

function spaceHasOtherMeaning(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.closest(ORB)) return false;
  return (
    target.isContentEditable ||
    Boolean(target.closest('input, textarea, select, button, a, [role="textbox"], [role="menu"]'))
  );
}
