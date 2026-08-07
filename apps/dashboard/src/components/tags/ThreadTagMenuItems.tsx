import { JSX, useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { THREAD_TYPES } from '@xyne/shared';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';

/** Matches the mutator's cap, so the UI cannot offer something the server will reject. */
const MAX_TAG_LENGTH = 40;

interface ThreadTagMenuItemsProps {
  applied: string[];
  onToggle: (name: string) => void;
}

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * The body of the "Thread tags" submenu, shared by the message hover toolbar and the
 * thread panel header so the two stay identical.
 *
 * The listed choices are deliberately just the built-in vocabulary plus whatever this
 * thread already carries — a menu that grows with every tag anyone ever invented stops
 * being scannable. Anything else is reached by typing it.
 */
export const ThreadTagMenuItems = ({ applied, onToggle }: ThreadTagMenuItemsProps): JSX.Element => {
  const [search, setSearch] = useState('');
  const query = normalize(search);

  const builtIn = useMemo(
    () => THREAD_TYPES.filter(entry => !query || normalize(entry.label).includes(query)),
    [query],
  );

  // Custom tags already on this thread, so they can be unticked from the same list.
  const custom = useMemo(() => {
    const builtInNames = new Set(THREAD_TYPES.map(entry => normalize(entry.name)));
    return applied
      .filter(name => !builtInNames.has(normalize(name)))
      .filter(name => !query || normalize(name).includes(query));
  }, [applied, query]);

  const trimmed = search.trim().slice(0, MAX_TAG_LENGTH);
  const alreadyExists = [...THREAD_TYPES.map(e => e.name), ...applied].some(
    name => normalize(name) === query,
  );
  const canCreate = trimmed.length > 0 && !alreadyExists;

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
            onToggle(trimmed);
            setSearch('');
          }
        }}
        maxLength={MAX_TAG_LENGTH}
        placeholder='Search or add a tag'
        data-track-category='Tags'
        data-track-name='ThreadTagSearch'
        aria-label='Search or add a thread tag'
        className='w-full px-2 py-1.5 mb-1 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground'
      />

      {builtIn.map(entry => row(entry.name, entry.label, entry.color))}
      {custom.length > 0 && builtIn.length > 0 && <DropdownMenuSeparator />}
      {custom.map(name => row(name, name, undefined))}

      {canCreate && (
        <>
          {(builtIn.length > 0 || custom.length > 0) && <DropdownMenuSeparator />}
          <DropdownMenuItem
            className='gap-2'
            onSelect={event => {
              event.preventDefault();
              onToggle(trimmed);
              setSearch('');
            }}
            data-track-category='Tags'
            data-track-name='CreateThreadTag'
          >
            <Plus size={14} className='shrink-0 text-muted-foreground' />
            <span className='flex-1 truncate'>Add “{trimmed}”</span>
          </DropdownMenuItem>
        </>
      )}
    </>
  );
};
