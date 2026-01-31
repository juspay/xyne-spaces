import { useVirtualizer, VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import { RefObject, useEffect, useRef, useState } from 'react';

interface UseChatVirtualizerParams<T> {
  items: T[];
  scrollOffset?: number;
  activeItemId?: string;
  extractId: (item: T) => string;
  onScrollOffsetChange?: (offset: number) => void;
}

export interface UseChatVirtualizerReturn<T> {
  items: T[];
  parentRef: RefObject<HTMLDivElement>;
  virtualItems: VirtualItem[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  handleScroll: () => void;
}

export function useChatVirtualizer<T>({
  items,
  scrollOffset,
  activeItemId,
  extractId,
  onScrollOffsetChange,
}: UseChatVirtualizerParams<T>): UseChatVirtualizerReturn<T> {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
    measureElement: el => el?.getBoundingClientRect().height ?? 60,
  });

  const virtualItems = virtualizer.getVirtualItems();

  /** SCROLL TO BOTTOM WHEN NEW MESSAGES ARRIVE */
  useEffect(() => {
    if (!isAutoScroll) return;
    virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
  }, [items.length, isAutoScroll, virtualizer]);

  /** RESTORE SCROLL POSITION WHEN RE-ENTERING CHAT */
  useEffect(() => {
    if (scrollOffset !== undefined && parentRef.current) {
      parentRef.current.scrollTop = scrollOffset;
      setIsAutoScroll(false);
    }
  }, [scrollOffset]);

  /** SCROLL TO A SPECIFIC MESSAGE OR SEPARATOR */
  useEffect(() => {
    if (!activeItemId) return;

    const index = items.findIndex(i => extractId(i) === activeItemId);
    if (index === -1) return;

    virtualizer.scrollToIndex(index, {
      align: 'center',
      behavior: 'smooth',
    });

    setIsAutoScroll(false);
  }, [activeItemId, extractId, items, virtualizer]);

  /** TRACK SCROLL AND AUTO-SCROLL STATE */
  const handleScroll = (): void => {
    const el = parentRef.current;
    if (!el) return;

    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 40;

    setIsAutoScroll(nearBottom);
    onScrollOffsetChange?.(el.scrollTop);
  };

  return {
    items,
    parentRef: parentRef as RefObject<HTMLDivElement>,
    virtualItems,
    virtualizer,
    handleScroll,
  };
}
