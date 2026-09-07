import { JSX, useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { normalizeThreadTypeName } from '@xyne/shared';
import { useThreadTypeVocabulary } from '../../hooks/useThreadTypeVocabulary';

/** Matches the server's cap, so the UI cannot offer something the API will reject. */
const MAX_TAG_LENGTH = 40;

interface ThreadTagMenuItemsProps {
  applied: string[];
  onToggle: (name: string) => void;
}

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * The body of the "Thread tags" submenu, used by the thread panel header.
 *
 * The listed choices are the workspace's vocabulary plus whatever this thread already
 * carries — a menu that grows with every tag anyone ever invented stops being scannable.
 * Anything else is reached by typing it.
 */
export const ThreadTagMenuItems = ({ applied, onToggle }: ThreadTagMenuItemsProps): JSX.Element => {
  const [search, setSearch] = useState('');
  const query = normalize(search);
  const { entries } = useThreadTypeVocabulary();

  const vocabulary = useMemo(
    () => entries.filter(entry => !query || normalize(entry.label).includes(query)),
    [entries, query],
  );

  // Tags on this thread that the vocabulary doesn't cover — free-form ones, and entries an
  // admin has since removed — so they can be unticked from the same list.
  const custom = useMemo(() => {
    const known = new Set(entries.map(entry => normalize(entry.name)));
    return applied
      .filter(name => !known.has(normalize(name)))
      .filter(name => !query || normalize(name).includes(query));
  }, [applied, entries, query]);

  // What typing this would actually create. Shown rather than applied to the input itself,
  // because the same box is the SEARCH box — forcing the field to uppercase would fight
  // someone typing "feature" to find "Feature request".
  const proposed = normalizeThreadTypeName(search).slice(0, MAX_TAG_LENGTH);
  // Compared in normalised form, so "vespa latency" does not offer to create a second tag
  // when VESPA_LATENCY already exists.
  const alreadyExists = [...entries.map(e => e.name), ...applied].some(
    name => normalizeThreadTypeName(name) === proposed,
  );
  const canCreate = proposed.length > 0 && !alreadyExists;

  const create = (): void => {
    onToggle(proposed);
    setSearch('');
  };

  const row = (name: string, label: string, color: string | undefined): JSX.Element => (
    <DropdownMenuItem
      key={name}
      className='gap-2'
      // Not closing on select: tagging is usually a couple of picks.
      onSelect={event => {
        event.preventDefault();
        onToggle(name);
      }}
      data-track-category='Tags'
      data-track-name='ToggleThreadTag'
    >
      <span
        className='size-2 rounded-full shrink-0'
        style={{ backgroundColor: color ?? 'hsl(var(--muted-foreground))' }}
      />
      <span className='flex-1 truncate'>{label}</span>
      {applied.some(value => normalize(value) === normalize(name)) && (
        <Check size={14} className='shrink-0 text-muted-foreground' />
      )}
    </DropdownMenuItem>
  );

  return (
    <>
      <input
        value={search}
        onChange={event => setSearch(event.target.value)}
        // Radix menus steal keystrokes for typeahead and close on Escape/Enter; this input
        // has to keep its own.
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Enter' && canCreate) {
            event.preventDefault();
            create();
          }
        }}
        maxLength={MAX_TAG_LENGTH}
        placeholder='Search or add a tag'
        data-track-category='Tags'
        data-track-name='ThreadTagSearch'
        aria-label='Search or add a thread tag'
        className='w-full px-2 py-1.5 mb-1 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground'
      />

      {vocabulary.map(entry => row(entry.name, entry.label, entry.color))}
      {custom.length > 0 && vocabulary.length > 0 && <DropdownMenuSeparator />}
      {custom.map(name => row(name, name, undefined))}

      {canCreate && (
        <>
          {(vocabulary.length > 0 || custom.length > 0) && <DropdownMenuSeparator />}
          <DropdownMenuItem
            className='gap-2'
            onSelect={event => {
              event.preventDefault();
              create();
            }}
            data-track-category='Tags'
            data-track-name='CreateThreadTag'
          >
            <Plus size={14} className='shrink-0 text-muted-foreground' />
            {/* The NORMALISED name, not what was typed: this is the string that lands on the
                thread, gets indexed, and goes into the review queue, so it is the string to
                show before anyone commits to it. */}
            <span className='flex-1 truncate'>
              Add <span className='font-mono'>{proposed}</span>
            </span>
          </DropdownMenuItem>
        </>
      )}
    </>
  );
};
