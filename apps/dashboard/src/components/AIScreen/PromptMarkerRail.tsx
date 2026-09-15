/**
 * A scroll rail marking where each of your prompts sits in the conversation.
 *
 * Long agent turns push a thread to many screens tall, and the only landmarks
 * in it are the things YOU said — the answers are what you are scrolling
 * through, not what you are looking for. So the rail marks user prompts only:
 * one tick per turn.
 *
 * The ticks are EVENLY SPACED and centred as a group, not positioned
 * proportionally to where each message sits. Proportional placement sounds more
 * honest but reads worse: one long agent turn pushes its neighbours into a
 * cluster of overlapping ticks with a wide empty gap beside it, and the ticks
 * stop being clickable. An even list is a table of contents rather than a
 * scrollbar — the ordering is the information, and every tick keeps the same
 * hit area no matter how long the answers run.
 *
 * Which tick is CURRENT is still measured from the DOM, because a message's
 * height is not knowable up front: markdown, artifacts, tool blocks and images
 * all settle after mount, and a streaming answer grows continuously.
 */

import { useCallback, useEffect, useState, type ReactElement, type RefObject } from 'react';

export interface PromptMarker {
  id: string;
  /** The prompt text, used for the hover preview. */
  text: string;
}

/** Enough to recognise a turn without turning the rail into a reading surface. */
const PREVIEW_CHARS = 140;

export const PromptMarkerRail = ({
  markers,
  scrollRef,
}: {
  markers: PromptMarker[];
  /** The scroll container the ticks are measured against. */
  scrollRef: RefObject<HTMLDivElement | null>;
}): ReactElement | null => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Which tick reads as "you are here": the last prompt whose message sits at
  // or above the middle of the viewport. Middle rather than top, so a prompt
  // scrolled just past the top edge still counts as the one you are reading
  // under. Measured live off the DOM — the rail's own layout says nothing about
  // where anything actually is.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const sync = (): void => {
      const mid = scroll.scrollTop + scroll.clientHeight / 2;
      let current: string | null = null;
      for (const marker of markers) {
        const el = scroll.querySelector<HTMLElement>(
          `[data-prompt-marker="${CSS.escape(marker.id)}"]`,
        );
        if (!el) continue;
        if (el.offsetTop <= mid) current = marker.id;
        else break;
      }
      setActiveId(current);
    };

    sync();
    scroll.addEventListener('scroll', sync, { passive: true });
    // Content settles and grows after mount, which moves every message without
    // a scroll event ever firing.
    const ro = new ResizeObserver(sync);
    ro.observe(scroll);
    return () => {
      scroll.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [markers, scrollRef]);

  const jumpTo = useCallback(
    (id: string): void => {
      const scroll = scrollRef.current;
      const el = scroll?.querySelector<HTMLElement>(`[data-prompt-marker="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    [scrollRef],
  );

  // One prompt is not a map. The rail earns its space only once a thread has
  // somewhere to navigate to.
  if (markers.length < 2) return null;

  return (
    <div
      // Centred as a group on the left edge. `pointer-events-none` so the rail
      // never steals a click from the transcript beneath it; the ticks take the
      // pointer back individually.
      className='pointer-events-none absolute inset-y-0 left-0 z-20 hidden w-8 items-center md:flex'
    >
      <div
        // `pointer-events-auto` here is what lets the 2px gap exist without
        // the preview blinking. The rail wrapper is pointer-events-none, so an
        // un-owned gap passes the pointer through to the transcript below —
        // which is OUTSIDE this subtree, firing the group's mouseleave and
        // clearing hover mid-travel. Owning the column makes the gap part of
        // the group, so crossing it keeps the last tick previewed.
        className='pointer-events-auto flex w-full flex-col items-start gap-[2px] py-2'
        role='navigation'
        aria-label='Your prompts'
        onMouseLeave={() => setHoverId(null)}
      >
        {markers.map(marker => {
          const isActive = marker.id === activeId;
          const isHover = marker.id === hoverId;
          return (
            <button
              key={marker.id}
              type='button'
              onClick={() => jumpTo(marker.id)}
              onMouseEnter={() => setHoverId(marker.id)}
              onFocus={() => setHoverId(marker.id)}
              onBlur={() => setHoverId(current => (current === marker.id ? null : current))}
              aria-label={truncate(marker.text)}
              aria-current={isActive ? 'true' : undefined}
              // A 2px line is not a hit target: the button owns a taller band
              // with the tick drawn centred inside it. The bands touch, so the
              // pointer is never off a tick while travelling the rail.
              className='pointer-events-auto flex h-2 w-full items-center pl-1 focus:outline-none'
              data-track-category='AskAI'
              data-track-name='PromptMarkerJump'
            >
              <span
                className={`block h-[2px] rounded-full transition-all ${
                  isActive
                    ? 'w-5 bg-foreground'
                    : isHover
                      ? 'w-4 bg-muted-foreground'
                      : 'w-2.5 bg-border'
                }`}
              />
            </button>
          );
        })}
      </div>

      {hoverId !== null && (
        <div className='pointer-events-none absolute left-8 top-1/2 z-30 w-64 -translate-y-1/2 rounded-xl border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg'>
          {truncate(markers.find(m => m.id === hoverId)?.text ?? '')}
        </div>
      )}
    </div>
  );
};

function truncate(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS)}…` : clean;
}
