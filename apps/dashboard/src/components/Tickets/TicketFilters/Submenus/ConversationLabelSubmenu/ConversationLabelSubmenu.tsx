import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { SearchDefault as Search, CheckTickSingle as Check, Tag } from '@xyne/icons';
import { queries } from '../../../../../zero/queries';
import { useCachedQuery } from '../../../../../hooks/useCachedQuery';
import { usePlatform } from '../../../../../hooks/usePlatform';
import Input from '../../../../ui/Input/Input';

const ALL_CHANNELS_ID = 'all';

// Deterministic fallback color when a label has none — mirrors DeskLabelsSidebar so the
// same label reads the same color in the sidebar and in this filter.
const LABEL_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];
const colorForName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length] ?? '#6b7280';
};

interface ConversationLabelSubmenuProps {
  /** Currently-filtered label id, or undefined when no label filter is applied. */
  selectedLabelId: string | undefined;
  /** Single-select: emits the picked label id, or undefined when the selection is cleared. */
  onChange: (labelId: string | undefined) => void;
  channelId: string | null;
}

/**
 * Single-select list of a desk channel's Gmail-style conversation labels, used as a
 * "Label" option in the desk's More Filters popover. Picking the active label again
 * clears the filter.
 */
export const ConversationLabelSubmenu = ({
  selectedLabelId,
  onChange,
  channelId,
}: ConversationLabelSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [labels] = useCachedQuery(
    queries.conversationLabelsByChannelId({ channelId: channelId ?? '' }),
    { enabled: !!channelId && channelId !== ALL_CHANNELS_ID },
  );

  const availableLabels = useMemo(() => labels ?? [], [labels]);

  const filteredLabels = useMemo(() => {
    let list = [...availableLabels];
    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(label => label.name.toLowerCase().includes(lower));
    }
    return list.sort((a, b) => {
      const aSel = a.id === selectedLabelId ? 1 : 0;
      const bSel = b.id === selectedLabelId ? 1 : 0;
      return bSel - aSel;
    });
  }, [availableLabels, searchTerm, selectedLabelId]);

  const handleSelect = (labelId: string): void => {
    // Re-selecting the active label clears the filter (single-select toggle).
    onChange(labelId === selectedLabelId ? undefined : labelId);
  };

  return (
    <div className='w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden'>
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search labels...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox'>
        {availableLabels.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No labels available</div>
        ) : filteredLabels.length > 0 ? (
          <div className='space-y-0.5'>
            {filteredLabels.map(label => {
              const isSelected = label.id === selectedLabelId;
              const color = label.color ?? colorForName(label.name);
              return (
                <button
                  key={label.id}
                  onClick={() => handleSelect(label.id)}
                  type='button'
                  className={`
                    w-full flex items-center justify-between px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleConversationLabelFilter'
                  data-track-metadata={JSON.stringify({ labelId: label.id, selected: !isSelected })}
                >
                  <div className='flex items-center gap-2 min-w-0'>
                    <Tag className='w-3.5 h-3.5 shrink-0' style={{ color }} fill={color} />
                    <span className='text-sm font-medium truncate'>{label.name}</span>
                  </div>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>No labels found</div>
        )}
      </div>
    </div>
  );
};
