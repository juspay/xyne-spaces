import { useCallback, useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import {
  ChatDefault,
  ChevronRight,
  FolderAi,
  Hashtag,
  LockClose,
  MultipleCrossCancelDefault,
  PlusDefault,
  SearchDefault,
} from '@xyne/icons';
import { ChannelVisibility, type ProjectSectionSuggestion } from '@xyne/shared';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { cn } from '../../../utils/classNames';
import { isDMChannel, getDMSearchableName } from './ChatDirectory.utils';
import type { VisibleChannel } from '../../../machines/stateMachine';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';

const AUTO_EXPAND_MAX_CHANNELS = 25;

export interface OrganizerGroup {
  projectId: string;
  name: string;
  channelIds: string[];
  excludedChannelIds: string[];
  included: boolean;
  expanded: boolean;
}

interface SectionOrganizerDialogProps {
  suggestions: readonly ProjectSectionSuggestion[];
  channelsById: Map<string, VisibleChannel>;
  existingNames: readonly string[];
  onCancel: () => void;
  onConfirm: (groups: OrganizerGroup[]) => void;
}

const ChannelIcon = ({ channel }: { channel: VisibleChannel }): ReactElement => {
  if (isDMChannel(channel.scopeType)) return <ChatDefault size={14} />;
  if (channel.visibility === ChannelVisibility.PRIVATE) return <LockClose size={14} />;
  return <Hashtag size={14} />;
};

const ChannelLine = ({
  channel,
  excluded,
  onToggle,
}: {
  channel: VisibleChannel;
  excluded: boolean;
  onToggle: () => void;
}): ReactElement => {
  const { userID } = useAuthContextValues();
  const { displayName } = useChannelDisplayName(channel, userID);
  return (
    <div
      className={cn(
        'group flex h-9 items-center gap-3 rounded-[10px] border border-transparent px-3 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        excluded ? 'text-muted-foreground' : 'text-sidebar-foreground',
      )}
    >
      <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
        <ChannelIcon channel={channel} />
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', excluded && 'line-through')}>
        {displayName}
      </span>
      <button
        type='button'
        onClick={onToggle}
        aria-label={excluded ? `Add ${displayName} back` : `Remove ${displayName}`}
        data-track-category='CHAT_SIDEBAR'
        data-track-name={excluded ? 'ORGANIZER_RESTORE_CHANNEL' : 'ORGANIZER_REMOVE_CHANNEL'}
        className={cn(
          'shrink-0 rounded p-0.5 text-muted-foreground transition-opacity hover:text-foreground',
          excluded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {excluded ? <PlusDefault size={13} /> : <MultipleCrossCancelDefault size={13} />}
      </button>
    </div>
  );
};

export const SectionOrganizerDialog = ({
  suggestions,
  channelsById,
  existingNames,
  onCancel,
  onConfirm,
}: SectionOrganizerDialogProps): ReactElement => {
  const totalChannels = useMemo(
    () => suggestions.reduce((sum, s) => sum + s.channelIds.length, 0),
    [suggestions],
  );

  const [filter, setFilter] = useState('');
  const [groups, setGroups] = useState<OrganizerGroup[]>(() =>
    suggestions.map(s => ({
      projectId: s.projectId,
      name: s.name,
      channelIds: [...s.channelIds],
      excludedChannelIds: [],
      included: true,
      expanded: totalChannels <= AUTO_EXPAND_MAX_CHANNELS,
    })),
  );

  const { userID } = useAuthContextValues();
  const allUsers = useUsers();
  const userMap = useMemo(
    () => new Map(allUsers.map(u => [u.id, getUserDisplayName(u)])),
    [allUsers],
  );

  const query = filter.trim().toLowerCase();

  const matchesQuery = useCallback(
    (channelId: string): boolean => {
      if (!query) return true;
      const channel = channelsById.get(channelId);
      if (!channel) return false;
      return getDMSearchableName(channel, userMap, userID).toLowerCase().includes(query);
    },
    [query, channelsById, userMap, userID],
  );

  const visibleGroups = useMemo(() => {
    if (!query) return groups;
    return groups
      .map(g => ({ ...g, channelIds: g.channelIds.filter(matchesQuery) }))
      .filter(g => g.channelIds.length > 0 || g.name.toLowerCase().includes(query));
  }, [groups, query, matchesQuery]);

  const updateGroup = (projectId: string, patch: Partial<OrganizerGroup>): void => {
    setGroups(prev => prev.map(g => (g.projectId === projectId ? { ...g, ...patch } : g)));
  };

  const toggleChannel = (projectId: string, channelId: string): void => {
    setGroups(prev =>
      prev.map(g => {
        if (g.projectId !== projectId) return g;
        const excluded = g.excludedChannelIds.includes(channelId)
          ? g.excludedChannelIds.filter(id => id !== channelId)
          : [...g.excludedChannelIds, channelId];
        return { ...g, excludedChannelIds: excluded };
      }),
    );
  };

  const includedCount = (group: OrganizerGroup): number =>
    group.channelIds.filter(id => !group.excludedChannelIds.includes(id)).length;

  const selectedGroups = groups
    .filter(g => g.included && includedCount(g) > 0)
    .map(g => ({ ...g, channelIds: g.channelIds.filter(id => !g.excludedChannelIds.includes(id)) }));
  const takenNames = new Set(existingNames.map(n => n.trim().toLowerCase()));

  const invalidNames = new Set<string>();
  const seen = new Set<string>();
  for (const group of selectedGroups) {
    const normalized = group.name.trim().toLowerCase();
    if (!normalized || takenNames.has(normalized) || seen.has(normalized)) {
      invalidNames.add(group.projectId);
    }
    seen.add(normalized);
  }

  const canConfirm = selectedGroups.length > 0 && invalidNames.size === 0;

  return (
    <div className='flex max-h-[80vh] flex-col gap-4 p-4' data-testid='section-organizer-dialog'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='flex items-center gap-1.5 text-base font-medium leading-tight text-foreground'>
            <FolderAi size={16} className='text-primary' />
            Organize your channels
          </div>
          <div className='mt-1 text-xs text-muted-foreground'>
            See how your sidebar could look.
          </div>
        </div>
        <button
          type='button'
          onClick={onCancel}
          aria-label='Close'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='CLOSE_SECTION_ORGANIZER'
          className='-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <MultipleCrossCancelDefault size={20} />
        </button>
      </div>

      <div className='flex items-center gap-2 rounded-md border border-border bg-background px-2 focus-within:ring-2 focus-within:ring-ring'>
        <SearchDefault size={16} className='shrink-0 text-muted-foreground' />
        <input
          value={filter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          placeholder='Find a channel…'
          autoComplete='off'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='ORGANIZER_SEARCH'
          className='flex-1 border-0 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
        />
      </div>

      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-sidebar/40 p-2'>
            {visibleGroups.map(group => {
              const isOpen = (group.expanded || !!query) && group.included;
              const hasNameError = invalidNames.has(group.projectId);
              return (
                <div key={group.projectId} className='mb-1'>
                  <div className='flex h-9 items-center gap-1.5 rounded-[10px] border border-transparent px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'>
                    <Checkbox
                      checked={group.included}
                      onChange={included => updateGroup(group.projectId, { included })}
                      ariaLabel={`Include ${group.name}`}
                      label=''
                      size='sm'
                    />
                    <button
                      type='button'
                      onClick={() => updateGroup(group.projectId, { expanded: !group.expanded })}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                      data-track-category='CHAT_SIDEBAR'
                      data-track-name='ORGANIZER_TOGGLE_EXPAND'
                      className='shrink-0 text-muted-foreground'
                    >
                      <ChevronRight
                        size={13}
                        className={cn('transition-transform', isOpen && 'rotate-90')}
                      />
                    </button>
                    <input
                      value={group.name}
                      onChange={e => updateGroup(group.projectId, { name: e.target.value })}
                      maxLength={50}
                      disabled={!group.included}
                      data-track-category='CHAT_SIDEBAR'
                      data-track-name='ORGANIZER_RENAME_SECTION'
                      className={cn(
                        'min-w-0 flex-1 border-0 border-b border-transparent bg-transparent px-0.5 py-0.5 text-sm font-medium text-foreground outline-none focus:border-b-primary',
                        !group.included && 'text-muted-foreground line-through',
                        hasNameError && 'border-b-destructive focus:border-b-destructive',
                      )}
                    />
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      {includedCount(group)}
                    </span>
                  </div>

                  {isOpen && (
                    <div className='pl-6'>
                      {group.channelIds.map(channelId => {
                        const channel = channelsById.get(channelId);
                        if (!channel) return null;
                        return (
                          <ChannelLine
                            key={channelId}
                            channel={channel}
                            excluded={group.excludedChannelIds.includes(channelId)}
                            onToggle={() => toggleChannel(group.projectId, channelId)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {visibleGroups.length === 0 && (
              <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                No channels found
              </div>
            )}
        </div>
      </div>

      <div className='flex items-center justify-between gap-3'>
        <span className='text-xs text-muted-foreground'>
          DMs can be added by dragging them into a section.
        </span>
        <span className={cn('inline-flex', !canConfirm && 'cursor-not-allowed')}>
          <Button
            type='button'
            variant='default'
            size='default'
            disabled={!canConfirm}
            onClick={() => onConfirm(selectedGroups)}
            data-track-category='CHAT_SIDEBAR'
            data-track-name='ORGANIZER_CONFIRM'
          >
            {selectedGroups.length === 0
              ? 'Create sections'
              : `Create ${selectedGroups.length} section${selectedGroups.length === 1 ? '' : 's'}`}
          </Button>
        </span>
      </div>
    </div>
  );
};

export default SectionOrganizerDialog;
