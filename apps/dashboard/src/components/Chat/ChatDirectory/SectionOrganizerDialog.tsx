import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
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
import {
  ChannelVisibility,
  MAX_ACTIVE_WINDOW_DAYS,
  MIN_ACTIVE_WINDOW_DAYS,
  SECTION_NAME_MAX_LENGTH,
  clampActiveWindowDays,
  type SectionSuggestion,
} from '@xyne/shared';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import {
  SegmentedToggle,
  type SegmentedToggleOption,
} from '../../ui/SegmentedToggle/SegmentedToggle';
import { cn } from '../../../utils/classNames';
import { isDMChannel, getDMSearchableName } from './ChatDirectory.utils';
import type { VisibleChannel } from '../../../machines/stateMachine';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';

const AUTO_EXPAND_MAX_CHANNELS = 25;

const MODE_OPTIONS: SegmentedToggleOption<OrganizerMode>[] = [
  { label: 'By project', value: 'project' },
  { label: 'By activity', value: 'activity' },
  { label: 'By DMs', value: 'dms' },
];
const TIP_INDEX_KEY = 'xyne:section-organizer-tip-index';

const SECTION_TIPS = [
  'Drag DMs into a section anytime.',
  'Your sections are private to you.',
  'Click a section name to rename it.',
  'Uncheck a section to skip it.',
  'Use × to remove a channel and + to add it back.',
  'Drag channels between sections anytime.',
];

export interface OrganizerGroup {
  id: string;
  name: string;
  channelIds: string[];
  excludedChannelIds: string[];
  included: boolean;
  expanded: boolean;
}

export type OrganizerMode = 'project' | 'activity' | 'dms';

interface SectionOrganizerDialogProps {
  suggestions: readonly SectionSuggestion[];
  channelsById: Map<string, VisibleChannel>;
  existingNames: readonly string[];
  mode: OrganizerMode;
  onModeChange: (mode: OrganizerMode) => void;
  activeWindowDays: number;
  onActiveWindowDaysChange: (days: number) => void;
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

const buildGroups = (
  suggestions: readonly SectionSuggestion[],
  totalChannels: number,
): OrganizerGroup[] =>
  suggestions.map(s => ({
    id: s.id,
    name: s.name,
    channelIds: [...s.channelIds],
    excludedChannelIds: [],
    included: true,
    expanded: totalChannels <= AUTO_EXPAND_MAX_CHANNELS,
  }));

export const SectionOrganizerDialog = ({
  suggestions,
  channelsById,
  existingNames,
  mode,
  onModeChange,
  activeWindowDays,
  onActiveWindowDaysChange,
  onCancel,
  onConfirm,
}: SectionOrganizerDialogProps): ReactElement => {
  const totalChannels = useMemo(
    () => suggestions.reduce((sum, s) => sum + s.channelIds.length, 0),
    [suggestions],
  );

  const [filter, setFilter] = useState('');
  const [groups, setGroups] = useState<OrganizerGroup[]>(() =>
    buildGroups(suggestions, totalChannels),
  );

  const suggestionsRef = useRef(suggestions);
  const totalChannelsRef = useRef(totalChannels);
  suggestionsRef.current = suggestions;
  totalChannelsRef.current = totalChannels;

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setGroups(buildGroups(suggestionsRef.current, totalChannelsRef.current));
  }, [mode, activeWindowDays]);

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

  const updateGroup = (groupId: string, patch: Partial<OrganizerGroup>): void => {
    setGroups(prev => prev.map(g => (g.id === groupId ? { ...g, ...patch } : g)));
  };

  const toggleChannel = (groupId: string, channelId: string): void => {
    setGroups(prev =>
      prev.map(g => {
        if (g.id !== groupId) return g;
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
    .map(g => ({
      ...g,
      channelIds: g.channelIds.filter(id => !g.excludedChannelIds.includes(id)),
    }));
  const takenNames = new Set(existingNames.map(n => n.trim().toLowerCase()));

  const invalidNames = new Set<string>();
  const seen = new Set<string>();
  for (const group of selectedGroups) {
    const normalized = group.name.trim().toLowerCase();
    if (!normalized || takenNames.has(normalized) || seen.has(normalized)) {
      invalidNames.add(group.id);
    }
    seen.add(normalized);
  }

  const canConfirm = selectedGroups.length > 0 && invalidNames.size === 0;

  const [tipIndex] = useState(() => {
    const stored = Number(localStorage.getItem(TIP_INDEX_KEY));
    return Number.isInteger(stored) && stored >= 0 ? stored % SECTION_TIPS.length : 0;
  });
  useEffect(() => {
    localStorage.setItem(TIP_INDEX_KEY, String((tipIndex + 1) % SECTION_TIPS.length));
  }, [tipIndex]);

  return (
    <div className='flex max-h-[80vh] flex-col gap-4 p-4' data-testid='section-organizer-dialog'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='flex items-center gap-1.5 text-base font-medium leading-tight text-foreground'>
            <FolderAi size={16} className='text-primary' />
            Organize your channels
          </div>
          <div className='mt-1 text-xs text-muted-foreground'>See how your sidebar could look.</div>
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

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <SegmentedToggle
          options={MODE_OPTIONS}
          value={mode}
          onChange={onModeChange}
          tone='primary'
          trackCategory='CHAT_SIDEBAR'
          trackPrefix='ORGANIZER_SET_MODE'
        />

        {mode === 'activity' && (
          <label className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            Active in the last
            <input
              type='number'
              min={MIN_ACTIVE_WINDOW_DAYS}
              max={MAX_ACTIVE_WINDOW_DAYS}
              value={activeWindowDays}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onActiveWindowDaysChange(clampActiveWindowDays(Number(e.target.value)))
              }
              data-track-category='CHAT_SIDEBAR'
              data-track-name='ORGANIZER_SET_ACTIVE_WINDOW'
              className='w-14 rounded border border-border bg-background px-1.5 py-1 text-center text-xs text-foreground outline-none focus:ring-2 focus:ring-ring'
            />
            days
          </label>
        )}
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

      <div className='flex min-h-0 flex-col'>
        <div className='max-h-[22rem] min-h-0 overflow-y-auto rounded-md border border-border bg-sidebar/40 p-2'>
          {visibleGroups.map(group => {
            const isOpen = (group.expanded || !!query) && group.included;
            const hasNameError = invalidNames.has(group.id);
            return (
              <div key={group.id} className='mb-1'>
                <div className='flex h-9 items-center gap-1.5 rounded-[10px] border border-transparent px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'>
                  <Checkbox
                    checked={group.included}
                    onChange={included => updateGroup(group.id, { included })}
                    ariaLabel={`Include ${group.name}`}
                    label=''
                    size='sm'
                  />
                  <button
                    type='button'
                    onClick={() => updateGroup(group.id, { expanded: !group.expanded })}
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
                    onChange={e => updateGroup(group.id, { name: e.target.value })}
                    maxLength={SECTION_NAME_MAX_LENGTH}
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
                          onToggle={() => toggleChannel(group.id, channelId)}
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
              {query
                ? 'No channels found'
                : mode === 'activity'
                  ? `Everything falls on one side of ${activeWindowDays} days. Try a shorter window.`
                  : mode === 'dms'
                    ? 'No app, bot or group DMs to group.'
                    : 'No channels found'}
            </div>
          )}
        </div>
      </div>

      <div className='flex items-center justify-between gap-3'>
        <span className='text-xs text-muted-foreground'>{SECTION_TIPS[tipIndex]}</span>
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
