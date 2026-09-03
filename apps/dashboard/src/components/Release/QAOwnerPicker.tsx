/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useMemo, useRef, useState } from 'react';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { cn } from '../../utils/classNames';
import { Popover } from '../ui/Popover/Popover';
import { Button } from '../ui/Button/Button';

interface QAOwnerPickerProps {
  artId: string | null;
  testedBy: string | null;
  /** Display name for testedBy, resolved by the parent — the closed picker
   *  must not need the full user list to label itself. */
  currentUserName?: string | null;
}

/**
 * Inline user-picker for the QA owner column in the Dev Tickets table.
 * Shows a searchable dropdown of workspace users. Clears on "Clear".
 */
export const QAOwnerPicker = ({
  artId,
  testedBy,
  currentUserName,
}: QAOwnerPickerProps): ReactElement => {
  const zero = useZero();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The full workspace user list is only needed while the dropdown is open.
  const [users] = useCachedQuery(queries.getUsersV2(), { enabled: open });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (users ?? []).filter(
      u => (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q),
    );
  }, [users, search]);

  const handleSelect = (userId: string | null): void => {
    if (!artId) return;
    void zero.mutate(
      mutators.applicationReleaseTicket.setTestedBy({ id: artId, userId, timestamp: Date.now() }),
    );
    setOpen(false);
    setSearch('');
  };

  const trigger = (
    <button
      type='button'
      onClick={e => e.stopPropagation()}
      data-track-category='Release'
      data-track-name='OPEN_QA_OWNER_PICKER'
      onKeyDown={e => e.stopPropagation()}
      className='text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors truncate max-w-[120px]'
      title={currentUserName ?? 'Unassigned'}
    >
      {currentUserName ?? <span className='text-muted-foreground'>Unassigned</span>}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch('');
      }}
      modal
      align='start'
      sideOffset={4}
      focusRef={searchInputRef}
      className='w-52 overflow-hidden p-0'
    >
      <input
        ref={searchInputRef}
        className='w-full px-3 py-2 text-xs border-b border-border outline-none bg-transparent'
        placeholder='Search users…'
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className='max-h-48 overflow-y-auto p-1'>
        {testedBy && (
          <Button
            variant='ghost'
            type='button'
            className='w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted'
            onClick={() => handleSelect(null)}
            data-track-category='Release'
            data-track-name='CLEAR_QA_OWNER'
            trackId='clear_qa_owner'
          >
            Clear
          </Button>
        )}
        {filtered.map(u => (
          <Button
            key={u.id}
            variant='ghost'
            type='button'
            className={cn(
              'w-full truncate rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
              u.id === testedBy && 'font-semibold',
            )}
            onClick={() => handleSelect(u.id)}
            data-track-category='Release'
            data-track-name='SELECT_QA_OWNER'
            trackId='select_qa_owner'
          >
            {u.name ?? u.email}
          </Button>
        ))}
        {filtered.length === 0 && (
          <p className='px-2 py-1.5 text-xs text-muted-foreground'>No users found</p>
        )}
      </div>
    </Popover>
  );
};
