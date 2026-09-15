import { useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import { Hash, Lock, MessageCircle, Search, X } from 'lucide-react';
import { ChannelVisibility, type ChannelSection } from '@xyne/shared';
import { isDMChannel, getDMSearchableName } from './ChatDirectory.utils';
import { Button } from '../../ui/Button';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import type { VisibleChannel } from '../../../machines/stateMachine';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface ManageSectionChannelsDialogProps {
  section: ChannelSection;
  channels: VisibleChannel[];
  currentChannelIds: string[];
  onSave: (toAdd: string[], toRemove: string[]) => void;
  onClose: () => void;
}

interface ChannelDialogRowProps {
  channel: VisibleChannel;
  checked: boolean;
  onChange: () => void;
}

const ChannelDialogRow = ({ channel, checked, onChange }: ChannelDialogRowProps): ReactElement => {
  const { userID } = useAuthContextValues();
  const { displayName } = useChannelDisplayName(channel, userID);
  return (
    <label className='flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-sidebar-item-hover'>
      <input
        type='checkbox'
        checked={checked}
        onChange={onChange}
        data-track-category='CHAT_SIDEBAR'
        data-track-name='MANAGE_SECTION_TOGGLE_CHANNEL'
        className='size-4 accent-action-primary'
      />
      <span className='shrink-0 text-muted-foreground'>
        {isDMChannel(channel.scopeType) ? (
          <MessageCircle size={14} />
        ) : channel.visibility === ChannelVisibility.PRIVATE ? (
          <Lock size={14} />
        ) : (
          <Hash size={14} />
        )}
      </span>
      <span className='flex-1 truncate text-sm text-foreground'>{displayName}</span>
    </label>
  );
};

export const ManageSectionChannelsDialog = ({
  section,
  channels,
  currentChannelIds,
  onSave,
  onClose,
}: ManageSectionChannelsDialogProps): ReactElement => {
  const original = useMemo(() => new Set(currentChannelIds), [currentChannelIds]);
  const [selected, setSelected] = useState<Set<string>>(new Set(currentChannelIds));
  const [filter, setFilter] = useState('');
  const { userID } = useAuthContextValues();
  const allUsers = useUsers();

  const userMap = useMemo(
    () => new Map(allUsers.map(u => [u.id, getUserDisplayName(u)])),
    [allUsers],
  );

  const filteredChannels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = !q
      ? channels
      : channels.filter(c => getDMSearchableName(c, userMap, userID).toLowerCase().includes(q));
    return [...base].sort((a, b) => {
      const aSelected = selected.has(a.id) ? 0 : 1;
      const bSelected = selected.has(b.id) ? 0 : 1;
      return aSelected - bSelected;
    });
  }, [channels, filter, selected, userMap, userID]);

  const allSelected = channels.length > 0 && channels.every(c => selected.has(c.id));

  const toggleChannel = (id: string): void => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) {
        channels.forEach(c => next.delete(c.id));
      } else {
        channels.forEach(c => next.add(c.id));
      }
      return next;
    });
  };

  const handleSave = (): void => {
    const toAdd = [...selected].filter(id => !original.has(id));
    const toRemove = [...original].filter(id => !selected.has(id));
    onSave(toAdd, toRemove);
  };

  return (
    <div className='space-y-4 p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='text-xl font-medium text-foreground'>Manage channels</div>
          <div className='flex items-center gap-1 text-sm text-muted-foreground'>
            {section.emoji && renderEmoji(section.emoji, 'size-4')}
            <span>{section.name}</span>
          </div>
        </div>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='CLOSE_MANAGE_SECTION'
          className='-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <X className='size-5' />
        </button>
      </div>

      <div className='flex items-center gap-2 rounded-md border border-border bg-background px-2 focus-within:ring-2 focus-within:ring-ring'>
        <Search className='size-4 shrink-0 text-muted-foreground' />
        <input
          value={filter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          placeholder='Filter by name…'
          autoComplete='off'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='MANAGE_SECTION_FILTER_CHANNELS'
          className='flex-1 border-0 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
        />
        {filter && (
          <button
            type='button'
            onClick={() => setFilter('')}
            className='shrink-0 text-muted-foreground hover:text-foreground transition-colors'
            aria-label='Clear search'
            data-track-category='CHAT_SIDEBAR'
            data-track-name='MANAGE_SECTION_CLEAR_FILTER'
          >
            <X className='size-4' />
          </button>
        )}
      </div>

      <div className='rounded-md border border-border'>
        <label className='flex cursor-pointer items-center justify-between gap-2 border-b border-border px-3 py-2'>
          <span className='flex items-center gap-2 text-sm font-medium text-foreground'>
            <input
              type='checkbox'
              checked={allSelected}
              onChange={toggleSelectAll}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='MANAGE_SECTION_SELECT_ALL'
              className='size-4 accent-action-primary'
            />
            Select all
          </span>
          <span className='text-xs text-muted-foreground'>{selected.size} selected</span>
        </label>
        <div className='max-h-64 overflow-y-auto'>
          {filteredChannels.length === 0 ? (
            <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
              No channels found
            </div>
          ) : (
            filteredChannels.map(channel => (
              <ChannelDialogRow
                key={channel.id}
                channel={channel}
                checked={selected.has(channel.id)}
                onChange={() => toggleChannel(channel.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className='flex justify-end gap-3 pt-2'>
        <Button
          type='button'
          variant='outline'
          size='default'
          onClick={onClose}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='CANCEL_MANAGE_SECTION_CHANNELS'
        >
          Cancel
        </Button>
        <Button
          type='button'
          variant='default'
          size='default'
          onClick={handleSave}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='SAVE_MANAGE_SECTION_CHANNELS'
          className='bg-action-primary text-action-primary-foreground hover:bg-action-primary/90'
        >
          Save
        </Button>
      </div>
    </div>
  );
};

export default ManageSectionChannelsDialog;
