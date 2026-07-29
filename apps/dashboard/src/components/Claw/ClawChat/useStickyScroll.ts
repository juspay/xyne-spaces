import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { CLAW_STICK_TO_BOTTOM_THRESHOLD } from './clawChat.constants';

export function useStickyScroll<T>(dependency: T): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  onScroll: () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const measure = useCallback((el: HTMLDivElement) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < CLAW_STICK_TO_BOTTOM_THRESHOLD;
    stickToBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    measure(el);
  }, [measure]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [dependency]);

  return { containerRef, isAtBottom, scrollToBottom, onScroll: handleScroll };
}
