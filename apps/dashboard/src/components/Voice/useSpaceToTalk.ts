import { useEffect, useRef, type RefObject } from 'react';

// A quicker tap is ignored, so Space still works as a normal key.
const HOLD_DELAY_MS = 200;

// Space is for the stage when focus is inside it, or nowhere in particular.
const isNowhere = (target: EventTarget | null): boolean =>
  target === null || target === document.body || target === document.documentElement;

/**
 * Hold Space to talk and release to send, while focus is inside `scope` or on nothing. Any other
 * focused element keeps its own Space (typing, buttons, menus). A focused button inside the scope
 * (say, a control just clicked) does not get activated by it.
 */
export function useSpaceToTalk(
  scope: RefObject<HTMLElement | null>,
  {
    onPress,
    onRelease,
  }: {
    onPress: () => void;
    onRelease: () => void;
  },
): void {
  const handlersRef = useRef({ onPress, onRelease });
  handlersRef.current = { onPress, onRelease };

  useEffect(() => {
    let holdTimer: number | null = null;
    let pressed = false;
    let talking = false;

    const release = (): void => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      holdTimer = null;
      if (talking) handlersRef.current.onRelease();
      talking = false;
      pressed = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      const { target } = event;
      if (!isNowhere(target) && !(target instanceof Node && scope.current?.contains(target)))
        return;
      event.preventDefault();
      if (pressed) return;
      pressed = true;
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        talking = true;
        handlersRef.current.onPress();
      }, HOLD_DELAY_MS);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || !pressed) return;
      // A button would otherwise be clicked as the key comes up.
      event.preventDefault();
      release();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // Switching windows mid-hold never delivers the keyup.
    window.addEventListener('blur', release);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, [scope]);
}
