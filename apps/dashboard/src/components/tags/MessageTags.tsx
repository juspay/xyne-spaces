import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Tag as TagIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { MESSAGE_ACTS, MESSAGE_ACT_NAMES, vocabularyEntry, PROJECT_TAG_TYPE } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Popover } from '../ui/Popover/Popover';
import { cn } from '../../utils/classNames';
import { colorForTagName } from './tagColors';

export type MessageTagSlot = 'chips' | 'picker';

interface MessageTagsProps {
  messageId: string;
  /** The message's current acts, as stored: a stringified JSON array, or null. */
  messageActs: string | null | undefined;
  slot: MessageTagSlot;
  /**
   * Reports popover open/close. The picker renders inside the shared hover toolbar, which
   * hides when the pointer leaves the message row — so the toolbar pins itself open while
   * this is true, or the popover unmounts as soon as you reach for it.
   */
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * Message act chips + picker.
 *
 * Reads straight off the message row — no query. Acts live in `messages.messageActs`, so
 * they arrive with the message the component is already rendering. That is the whole
 * reason the column exists rather than a join table.
 *
 * The vocabulary is a compile-time constant, so the picker needs no catalog fetch either.
 */
export const MessageTags = ({
  messageId,
  messageActs,
  slot,
  onOpenChange,
}: MessageTagsProps): JSX.Element | null => {
  const zero = useZero();
  const [pickerOpen, setPickerOpenState] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const setPickerOpen = (open: boolean): void => {
    setPickerOpenState(open);
    onOpenChange?.(open);
  };

  // Plain TEXT in the database, so parse defensively — nothing guarantees the shape.
  const applied = useMemo<string[]>(() => {
    if (!messageActs) return [];
    try {
      const parsed: unknown = JSON.parse(messageActs);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (v): v is string =>
          typeof v === 'string' && (MESSAGE_ACT_NAMES as readonly string[]).includes(v),
      );
    } catch {
      return [];
    }
  }, [messageActs]);

  const appliedSet = useMemo(() => new Set(applied), [applied]);

  useEffect(() => {
    if (pickerOpen) {
      inputRef.current?.focus();
    } else {
      setSearch('');
    }
  }, [pickerOpen]);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase().trim();
    if (!lower) return MESSAGE_ACTS;
    return MESSAGE_ACTS.filter(
      entry =>
        entry.name.toLowerCase().includes(lower) || entry.label.toLowerCase().includes(lower),
    );
  }, [search]);

  // The mutator takes the FULL desired set: the column is a single value, so a partial
  // add/remove would be a read-modify-write race.
  const setActs = async (acts: string[]): Promise<void> => {
    try {
      const result = await zero.mutate(
        mutators.messageTag.setActs({ messageId, acts: acts as never }),
      ).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to update tags');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tags');
    }
  };

  // Multi-select: a message can perform several acts at once, so the picker stays open.
  const toggle = (name: string): void => {
    const next = appliedSet.has(name) ? applied.filter(a => a !== name) : [...applied, name];
    void setActs(next);
    setSearch('');
  };

  if (slot === 'chips') {
    if (applied.length === 0) {
      return null;
    }
    return (
      <span className='inline-flex items-center gap-1 flex-wrap align-middle'>
        {applied.map(name => {
          const entry = vocabularyEntry(PROJECT_TAG_TYPE.MESSAGE_ACT, name);
          const color = entry?.color ?? colorForTagName(name);
          return (
            <span
              key={name}
              // Tinted pill, not a bordered card: these sit inline beside the message text
              // and "(edited)", so they must read as an annotation rather than a control.
              className='group/tag inline-flex items-center gap-0.5 pl-1.5 pr-1 py-[1px] rounded-full text-[11px] font-medium leading-[16px] whitespace-nowrap'
              style={{ backgroundColor: `${color}1f`, color }}
              title={entry?.description ?? name}
            >
              {entry?.label ?? name}
              <button
                type='button'
                aria-label={`Remove ${entry?.label ?? name}`}
                onClick={() => toggle(name)}
                // Width reserved, revealed on hover — removing is rare next to reading, and
                // opacity keeps the chip from resizing under the cursor.
                className='opacity-0 group-hover/tag:opacity-100 focus:opacity-100 transition-opacity rounded-full'
                data-track-category='Tags'
                data-track-name='RemoveMessageTag'
              >
                <X className='size-2.5' />
              </button>
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <Popover
      trigger={
        <button
          type='button'
          className={cn(
            'p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
          )}
          aria-label='Add tag'
          title='Tag'
          data-track-category='Tags'
          data-track-name='OpenMessageTagPicker'
        >
          <TagIcon size={16} />
        </button>
      }
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      side='bottom'
      align='start'
      sideOffset={6}
      className='p-0'
    >
      <div className='w-64 max-h-[280px] overflow-y-auto p-1'>
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const only = filtered.length === 1 ? filtered[0] : undefined;
              if (only) {
                toggle(only.name);
              }
            } else if (e.key === 'Escape') {
              setPickerOpen(false);
            }
          }}
          placeholder='Filter tags…'
          className='w-full bg-transparent border-b border-border text-sm px-2 py-1.5 outline-none mb-1'
          data-track-category='Tags'
          data-track-name='MessageTagSearchInput'
        />
        {filtered.map(entry => {
          const selected = appliedSet.has(entry.name);
          return (
            <button
              key={entry.name}
              type='button'
              onClick={() => toggle(entry.name)}
              title={entry.description}
              className='flex items-start justify-between w-full px-2 py-1.5 text-sm rounded text-left hover:bg-muted text-foreground'
              data-track-category='Tags'
              data-track-name='ToggleMessageTag'
            >
              <span className='flex items-start gap-2 min-w-0'>
                <span
                  className='size-2.5 rounded-full shrink-0 mt-1.5'
                  style={{ backgroundColor: entry.color }}
                />
                <span className='truncate'>{entry.label}</span>
              </span>
              {selected && <Check className='size-4 text-foreground shrink-0 mt-0.5' />}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className='p-3 text-center text-sm text-muted-foreground'>No match</div>
        )}
      </div>
    </Popover>
  );
};
