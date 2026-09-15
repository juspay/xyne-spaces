import { ReactElement, RefObject, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from '@xyne/icons';

export interface OffscreenUnreadSections {
  above: HTMLElement | null;
  below: HTMLElement | null;
}

type Position = 'above' | 'below' | 'visible';

export const useOffscreenUnreadSections = (
  containerRef: RefObject<HTMLDivElement | null>,
  sectionIds: readonly string[],
): OffscreenUnreadSections => {
  const [state, setState] = useState<OffscreenUnreadSections>({ above: null, below: null });
  const sectionKey = sectionIds.join('\n');

  useEffect(() => {
    const container = containerRef.current;
    const ids = sectionKey ? sectionKey.split('\n') : [];
    const clear = (): void =>
      setState(prev => (prev.above || prev.below ? { above: null, below: null } : prev));

    if (!container || ids.length === 0) {
      clear();
      return;
    }

    const elements = new Map<string, HTMLElement>();
    for (const id of ids) {
      const el = container.querySelector<HTMLElement>(`[data-sidebar-section="${CSS.escape(id)}"]`);
      if (el) elements.set(id, el);
    }
    if (elements.size === 0) {
      clear();
      return;
    }

    const positions = new Map<string, Position>();
    const sync = (): void => {
      let above: HTMLElement | null = null;
      let below: HTMLElement | null = null;
      for (const id of ids) {
        const el = elements.get(id);
        if (!el) continue;
        const position = positions.get(id);
        if (position === 'above') above = el;
        else if (position === 'below' && !below) below = el;
      }
      setState(prev => (prev.above === above && prev.below === below ? prev : { above, below }));
    };

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset['sidebarSection'];
          if (!id) continue;
          const root = entry.rootBounds;
          if (entry.isIntersecting || !root) positions.set(id, 'visible');
          else positions.set(id, entry.boundingClientRect.top >= root.bottom ? 'below' : 'above');
        }
        sync();
      },
      { root: container },
    );

    for (const el of elements.values()) observer.observe(el);

    return (): void => observer.disconnect();
  }, [containerRef, sectionKey]);

  return state;
};

interface UnreadMentionsPillProps {
  target: HTMLElement | null;
  direction: 'up' | 'down';
}

const UnreadMentionsPill = ({
  target,
  direction,
}: UnreadMentionsPillProps): ReactElement | null => {
  if (!target) return null;

  return (
    <button
      type='button'
      className='pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full bg-sidebar-primary px-3 py-1 text-xs font-medium text-sidebar-primary-foreground shadow-md'
      onClick={() => target.scrollIntoView({ block: 'start', behavior: 'smooth' })}
      data-track-category='CHAT_SIDEBAR'
      data-track-name='JUMP_TO_UNREAD_MENTION'
      data-track-metadata={JSON.stringify({ direction })}
    >
      {direction === 'up' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      Unread mentions
    </button>
  );
};

export default UnreadMentionsPill;
