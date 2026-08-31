import { ReactElement, RefObject, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RecipientSuggestion {
  email: string;
  name: string | undefined;
  // 'org'    — workspace user
  // 'desk'   — Gmail / Outlook contact pulled from the connected mailbox
  // 'thread' — extracted from this ticket's email history
  source: 'org' | 'desk' | 'thread';
}

interface RecipientSuggestionsDropdownProps {
  visible: boolean;
  suggestions: RecipientSuggestion[];
  highlightedIndex: number;
  onSelect: (email: string) => void;
  onHighlight: (index: number) => void;
  anchorRef: RefObject<HTMLElement | null>;
}

const DROPDOWN_GAP = 4;
const DROPDOWN_MAX_HEIGHT = 256;

export const RecipientSuggestionsDropdown = ({
  visible,
  suggestions,
  highlightedIndex,
  onSelect,
  onHighlight,
  anchorRef,
}: RecipientSuggestionsDropdownProps): ReactElement | null => {
  const isOpen = visible && suggestions.length > 0;

  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const anchor = anchorRef.current;
    if (!anchor) return undefined;

    const update = (): void => {
      const rect = anchor.getBoundingClientRect();
      setPos({
        left: rect.left,
        top: rect.bottom + DROPDOWN_GAP,
        width: rect.width,
      });
    };

    update();
    // ResizeObserver tracks layout changes the window doesn't fire events for —
    // adding a recipient tag wraps the row, growing its height; flex re-layout
    // shifts its left/width. Without this the dropdown drifts out of alignment.
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(anchor);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return (): void => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [isOpen, anchorRef, suggestions.length]);

  if (!isOpen || !pos) return null;

  return createPortal(
    <div
      role='listbox'
      tabIndex={-1}
      // mousedown so we beat the input's onBlur and the click still selects
      onMouseDown={e => e.preventDefault()}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: pos.width,
        maxHeight: DROPDOWN_MAX_HEIGHT,
        pointerEvents: 'auto',
      }}
      className='z-50 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md recipient-suggestions-dropdown'
    >
      {suggestions.map((s, idx) => {
        const isHighlighted = idx === highlightedIndex;
        const initial = (s.name?.charAt(0) || s.email.charAt(0) || '?').toUpperCase();
        return (
          <button
            key={s.email}
            type='button'
            role='option'
            aria-selected={isHighlighted}
            onMouseEnter={() => onHighlight(idx)}
            onClick={() => onSelect(s.email)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
              isHighlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            }`}
            data-track-category='Support'
            data-track-name='SelectRecipientSuggestion'
          >
            <span className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[4px] bg-border text-[10px] font-medium text-muted-foreground'>
              {initial}
            </span>
            <span className='flex flex-col min-w-0 flex-1'>
              {s.name && (
                <span className='truncate text-sm font-medium text-foreground'>{s.name}</span>
              )}
              <span
                className={`truncate text-xs ${
                  s.name ? 'text-muted-foreground' : 'text-foreground'
                }`}
              >
                {s.email}
              </span>
            </span>
            <span className='text-[10px] text-muted-foreground flex-shrink-0'>
              {s.source === 'org' ? 'Org' : s.source === 'desk' ? 'Contacts' : 'Recent'}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
