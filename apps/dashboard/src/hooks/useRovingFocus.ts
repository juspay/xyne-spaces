import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Attribute that marks an element as a stop in the roving group. Put it on the
 * focusable element itself (the <a> / <button>), not on a wrapper.
 */
export const ROVING_ITEM_ATTR = 'data-roving-item';

interface UseRovingFocusOptions {
  /**
   * 'vertical' listens to ArrowUp/ArrowDown, 'horizontal' to ArrowLeft/ArrowRight.
   * Both always honour Home/End.
   */
  orientation?: 'vertical' | 'horizontal';
  /** Wrap from the last item back to the first. Defaults to true. */
  loop?: boolean;
}

interface RovingFocusApi<T extends HTMLElement> {
  containerRef: RefObject<T | null>;
}

/**
 * Roving tabindex for a composite widget — the ARIA Authoring Practices pattern
 * for toolbars, menubars and navigation rails.
 *
 * Why this exists: the app rail is a list of ~12 icon links. Without this it is
 * 12 separate Tab stops, so a keyboard user has to press Tab a dozen times to
 * get past the sidebar to the content, and there is no fast way to move within
 * it. With it, the rail is ONE Tab stop and arrows move inside — which is what
 * screen-reader and keyboard users expect from a navigation rail, and what
 * every other product with a rail does.
 *
 * Contract:
 * - Exactly one item in the group has `tabIndex={0}`; the rest are `-1`. The
 *   tabbable one is whichever item is currently "active" (`aria-current`), else
 *   the last one the user focused, else the first.
 * - Arrow keys move focus (and the tabbable position) within the group.
 * - Tab leaves the group entirely — it does not step through the items.
 *
 * The hook owns the `tabIndex` attributes directly rather than through React
 * state on purpose: the rail re-renders on every route change and on Zero
 * pushes, and threading an index through that would make the tabbable item
 * reset under the user mid-interaction.
 */
export const useRovingFocus = <T extends HTMLElement>(
  options: UseRovingFocusOptions = {},
): RovingFocusApi<T> => {
  const { orientation = 'vertical', loop = true } = options;
  const containerRef = useRef<T | null>(null);
  // Index the user last landed on, so re-renders do not reset the entry point.
  const activeIndexRef = useRef<number>(0);

  const getItems = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) {
      return [];
    }
    return Array.from(container.querySelectorAll<HTMLElement>(`[${ROVING_ITEM_ATTR}]`)).filter(
      item => !item.hasAttribute('disabled') && item.getAttribute('aria-hidden') !== 'true',
    );
  }, []);

  const syncTabIndexes = useCallback((): void => {
    const items = getItems();
    if (items.length === 0) {
      return;
    }
    // Prefer the item the app considers current, so a keyboard user Tabbing in
    // lands on where they already are rather than at the top of the rail.
    const currentIndex = items.findIndex(item => item.getAttribute('aria-current') === 'page');
    const index =
      currentIndex >= 0
        ? currentIndex
        : Math.min(Math.max(activeIndexRef.current, 0), items.length - 1);
    activeIndexRef.current = index;
    items.forEach((item, i) => {
      item.tabIndex = i === index ? 0 : -1;
    });
  }, [getItems]);

  // Re-sync whenever the rail's contents change — pinned apps appear, nav items
  // are customised, the active route moves. A MutationObserver rather than a
  // dependency list because the items are rendered by the caller, not by us.
  useEffect(() => {
    syncTabIndexes();
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new MutationObserver(() => syncTabIndexes());
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-current'],
    });
    return (): void => observer.disconnect();
  }, [syncTabIndexes]);

  const focusItemAt = useCallback(
    (index: number): void => {
      const items = getItems();
      if (items.length === 0) {
        return;
      }
      let next = index;
      if (next < 0) {
        next = loop ? items.length - 1 : 0;
      } else if (next >= items.length) {
        next = loop ? 0 : items.length - 1;
      }
      activeIndexRef.current = next;
      items.forEach((item, i) => {
        item.tabIndex = i === next ? 0 : -1;
      });
      items[next]?.focus();
    },
    [getItems, loop],
  );

  // Bound imperatively rather than as a JSX onKeyDown prop: the container is a
  // landmark (<nav>), and hanging key handlers off a non-interactive element in
  // JSX is exactly what jsx-a11y/no-noninteractive-element-interactions exists
  // to catch. The listener is behaviourally identical and keeps the markup
  // honest about what the element is.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';

    const handler = (event: globalThis.KeyboardEvent): void => {
      if (
        event.key !== nextKey &&
        event.key !== prevKey &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }

      const items = getItems();
      const currentIndex = items.findIndex(item => item === document.activeElement);
      if (currentIndex < 0) {
        return;
      }

      // Only swallow the key once focus is genuinely inside the group, so
      // Home/End still scroll the page when it is not.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Home') {
        focusItemAt(0);
      } else if (event.key === 'End') {
        focusItemAt(items.length - 1);
      } else if (event.key === nextKey) {
        focusItemAt(currentIndex + 1);
      } else {
        focusItemAt(currentIndex - 1);
      }
    };

    container.addEventListener('keydown', handler);
    return (): void => container.removeEventListener('keydown', handler);
  }, [focusItemAt, getItems, orientation]);

  return { containerRef };
};
