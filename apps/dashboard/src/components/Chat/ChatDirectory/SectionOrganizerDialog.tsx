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
  FolderAi,
  FolderDefault,
  Hashtag,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import {
  ChannelVisibility,
  MAX_ACTIVE_WINDOW_DAYS,
  MIN_ACTIVE_WINDOW_DAYS,
  SECTION_NAME_MAX_LENGTH,
  clampActiveWindowDays,
  type SectionSuggestion,
} from '@xyne/shared';
import ChatLock from '../../icons/ChatLock';
import { Button } from '../../ui/Button';
import { Virtuoso } from 'react-virtuoso';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import {
  GROUPED_SELECT_LIST_HEIGHT,
  GroupedSelectList,
  GroupedSelectGroupHeader,
  GroupedSelectRow,
} from '../../ui/GroupedSelectList/GroupedSelectList';
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

const TITLE_CLICK_DELAY_MS = 200;

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
  'Untick every channel to skip a section.',
  'Untick a channel to leave it out of the section.',
  'Drag channels between sections anytime.',
];

export interface OrganizerGroup {
  id: string;
  name: string;
  channelIds: string[];
  excludedChannelIds: string[];
  expanded: boolean;
}

export type OrganizerMode = 'project' | 'activity' | 'dms';

type OrganizerRow =
  | {
      kind: 'header';
      group: OrganizerGroup;
      selectedInGroup: number;
      expanded: boolean;
      hasNameError: boolean;
    }
  | { kind: 'all'; group: OrganizerGroup; selectedInGroup: number }
  | { kind: 'channel'; group: OrganizerGroup; channel: VisibleChannel };

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
  if (channel.visibility === ChannelVisibility.PRIVATE) return <ChatLock />;
  return <Hashtag size={12} />;
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
    <GroupedSelectRow indented>
      <Checkbox
        checked={!excluded}
        onChange={onToggle}
        ariaLabel={`Include ${displayName}`}
        label=''
        data-track-category='CHAT_SIDEBAR'
        data-track-name={excluded ? 'ORGANIZER_RESTORE_CHANNEL' : 'ORGANIZER_REMOVE_CHANNEL'}
      />
      <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
        <ChannelIcon channel={channel} />
      </span>
      <span className='min-w-0 flex-1 truncate text-[13px] text-foreground'>{displayName}</span>
    </GroupedSelectRow>
  );
};

const groupsSignature = (suggestions: readonly SectionSuggestion[]): string =>
  suggestions.map(s => `${s.id}:${s.channelIds.join('|')}`).join(';');

const buildGroups = (
  suggestions: readonly SectionSuggestion[],
  totalChannels: number,
): OrganizerGroup[] =>
  suggestions.map(s => ({
    id: s.id,
    name: s.name,
    channelIds: [...s.channelIds],
    excludedChannelIds: [],
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

  const appliedSignatureRef = useRef(groupsSignature(suggestions));
  useEffect(() => {
    const nextSignature = groupsSignature(suggestionsRef.current);
    if (nextSignature === appliedSignatureRef.current) return;
    appliedSignatureRef.current = nextSignature;
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

  const toggleExpanded = (groupId: string): void => {
    setGroups(prev => prev.map(g => (g.id === groupId ? { ...g, expanded: !g.expanded } : g)));
  };

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const pendingToggleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingToggle = (): void => {
    if (pendingToggleRef.current === null) return;
    clearTimeout(pendingToggleRef.current);
    pendingToggleRef.current = null;
  };

  useEffect(() => cancelPendingToggle, []);

  const handleTitleClick = (groupId: string, clickCount: number): void => {
    if (clickCount > 1) return;
    cancelPendingToggle();
    pendingToggleRef.current = setTimeout(() => {
      pendingToggleRef.current = null;
      toggleExpanded(groupId);
    }, TITLE_CLICK_DELAY_MS);
  };

  const handleTitleDoubleClick = (groupId: string): void => {
    cancelPendingToggle();
    setEditingGroupId(groupId);
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

  const toggleAllChannels = (groupId: string, checked: boolean): void => {
    setGroups(prev =>
      prev.map(g =>
        g.id === groupId ? { ...g, excludedChannelIds: checked ? [] : [...g.channelIds] } : g,
      ),
    );
  };

  const liveChannelIds = (group: OrganizerGroup): string[] =>
    group.channelIds.filter(id => !group.excludedChannelIds.includes(id) && channelsById.has(id));

  const includedCount = (group: OrganizerGroup): number => liveChannelIds(group).length;

  const selectedGroups = groups
    .filter(g => includedCount(g) > 0)
    .map(g => ({ ...g, channelIds: liveChannelIds(g) }));
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

  const rows = useMemo((): OrganizerRow[] => {
    const out: OrganizerRow[] = [];
    for (const group of visibleGroups) {
      const selectedInGroup = group.channelIds.filter(
        id => !group.excludedChannelIds.includes(id) && channelsById.has(id),
      ).length;
      out.push({
        kind: 'header',
        group,
        selectedInGroup,
        expanded: group.expanded || !!query,
        hasNameError: invalidNames.has(group.id),
      });
      if (!(group.expanded || !!query)) continue;
      out.push({ kind: 'all', group, selectedInGroup });
      for (const channelId of group.channelIds) {
        const channel = channelsById.get(channelId);
        if (channel) out.push({ kind: 'channel', group, channel });
      }
    }
    return out;
  }, [visibleGroups, query, channelsById, invalidNames]);

  const canConfirm = selectedGroups.length > 0 && invalidNames.size === 0;
  const selectedChannelCount = selectedGroups.reduce((sum, g) => sum + g.channelIds.length, 0);

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

      <GroupedSelectList
        search={filter}
        onSearchChange={setFilter}
        searchPlaceholder='Search channels...'
        isEmpty={visibleGroups.length === 0}
        emptyLabel={
          query
            ? 'No channels found'
            : mode === 'activity'
              ? `Everything falls on one side of ${activeWindowDays} ${activeWindowDays === 1 ? 'day' : 'days'}. Try a shorter window.`
              : mode === 'dms'
                ? 'No app, bot or group DMs to group.'
                : 'No channels found'
        }
        trackCategory='CHAT_SIDEBAR'
        trackName='ORGANIZER_SEARCH'
        className='rounded-md border border-border'
        scrollable={false}
      >
        <Virtuoso
          data={rows}
          style={{ height: GROUPED_SELECT_LIST_HEIGHT }}
          overscan={200}
          defaultItemHeight={30}
          itemContent={(_, row) => {
            if (row.kind === 'header') {
              return (
                <GroupedSelectGroupHeader
                  expanded={row.expanded}
                  onToggleExpand={() => toggleExpanded(row.group.id)}
                  count={row.selectedInGroup}
                  trackCategory='CHAT_SIDEBAR'
                  trackName='ORGANIZER_TOGGLE_EXPAND'
                >
                  {editingGroupId === row.group.id ? (
                    <input
                      value={row.group.name}
                      autoFocus
                      onFocus={e => e.target.select()}
                      onChange={e => updateGroup(row.group.id, { name: e.target.value })}
                      onBlur={() => setEditingGroupId(null)}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== 'Escape') return;
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingGroupId(null);
                      }}
                      maxLength={SECTION_NAME_MAX_LENGTH}
                      data-track-category='CHAT_SIDEBAR'
                      data-track-name='ORGANIZER_RENAME_SECTION'
                      className={cn(
                        'min-w-0 flex-1 border-0 border-b border-transparent bg-transparent px-0.5 py-0.5 text-[13px] font-medium text-foreground outline-none focus:border-b-primary',
                        row.hasNameError && 'border-b-destructive focus:border-b-destructive',
                      )}
                    />
                  ) : (
                    <button
                      type='button'
                      onClick={e => handleTitleClick(row.group.id, e.detail)}
                      onDoubleClick={() => handleTitleDoubleClick(row.group.id)}
                      title='Double-click to rename'
                      data-track-category='CHAT_SIDEBAR'
                      data-track-name='ORGANIZER_TOGGLE_EXPAND'
                      className={cn(
                        'min-w-0 flex-1 truncate border-b border-transparent px-0.5 py-0.5 text-left text-[13px] font-medium text-foreground',
                        row.hasNameError && 'border-b-destructive',
                      )}
                    >
                      {row.group.name}
                    </button>
                  )}
                </GroupedSelectGroupHeader>
              );
            }
            if (row.kind === 'all') {
              return (
                <GroupedSelectRow indented>
                  <Checkbox
                    checked={
                      row.selectedInGroup > 0 && row.selectedInGroup === row.group.channelIds.length
                    }
                    indeterminate={
                      row.selectedInGroup > 0 && row.selectedInGroup < row.group.channelIds.length
                    }
                    onChange={checked => toggleAllChannels(row.group.id, checked)}
                    ariaLabel={`Include all channels in ${row.group.name}`}
                    label=''
                    data-track-category='CHAT_SIDEBAR'
                    data-track-name='ORGANIZER_TOGGLE_SECTION'
                  />
                  <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
                    <FolderDefault size={12} />
                  </span>
                  <span className='min-w-0 flex-1 truncate text-[13px] font-medium text-foreground'>
                    All channels
                  </span>
                </GroupedSelectRow>
              );
            }
            return (
              <ChannelLine
                channel={row.channel}
                excluded={row.group.excludedChannelIds.includes(row.channel.id)}
                onToggle={() => toggleChannel(row.group.id, row.channel.id)}
              />
            );
          }}
        />
      </GroupedSelectList>

      <div className='flex items-center justify-between gap-3'>
        <span className='text-xs text-muted-foreground'>
          {query
            ? `Filtered view — Create still applies to all ${selectedChannelCount} channels.`
            : SECTION_TIPS[tipIndex]}
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
