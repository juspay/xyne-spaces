import { useValue } from '@legendapp/state/react';
import { useCallback } from 'react';
import type { ChannelFilterMode, ChannelSortOrder } from '@xyne/shared';

import { useChannelGroupPreferences } from '@/src/hooks/useChannelGroupPreferences';
import { useChannelSections } from '@/src/hooks/useChannelSections';

import { channelSections$ } from '../state/rows-store';
import { sectionPicker$ } from '../state/section-picker-store';

export type GroupPreference = {
  /** The group's name: the section's, or `Channels`. */
  name: string;
  /** A section has a manual order and section actions; `Channels` has neither. */
  isSection: boolean;
  filterMode: ChannelFilterMode;
  /** `null` is a section's manual order. */
  sortOrder: ChannelSortOrder | null;
  setFilter: (filterMode: ChannelFilterMode) => void;
  setSort: (sortOrder: ChannelSortOrder | null) => void;
};

/**
 * The filter and sort of the group the section tray is about — a section, or
 * `Channels` — and how to change them.
 *
 * The same saved preferences the dashboard's section menu writes, so a choice
 * here follows the user to every other device. `null` while the tray is about
 * nothing, or about a section that has since been deleted.
 */
export function useGroupPreference(): GroupPreference | null {
  const sectionId = useValue(sectionPicker$.sectionId);
  const isChannelsGroup = useValue(sectionPicker$.isChannelsGroup);
  const section = useValue(() =>
    sectionId === null
      ? undefined
      : channelSections$.get().find(candidate => candidate.id === sectionId),
  );

  const { updatePreference } = useChannelSections();
  const { channels, update } = useChannelGroupPreferences();

  const setFilter = useCallback(
    (filterMode: ChannelFilterMode) => {
      if (sectionId !== null) updatePreference(sectionId, { filterMode });
      else if (isChannelsGroup) update('channels', { filterMode });
    },
    [isChannelsGroup, sectionId, update, updatePreference],
  );

  const setSort = useCallback(
    (sortOrder: ChannelSortOrder | null) => {
      if (sectionId !== null) updatePreference(sectionId, { sortOrder });
      // Channels has no manual order to return to.
      else if (isChannelsGroup && sortOrder !== null) update('channels', { sortOrder });
    },
    [isChannelsGroup, sectionId, update, updatePreference],
  );

  if (section !== undefined) {
    return {
      name: section.name,
      isSection: true,
      filterMode: section.filterMode,
      sortOrder: section.sortOrder,
      setFilter,
      setSort,
    };
  }
  if (isChannelsGroup) {
    return {
      name: 'Channels',
      isSection: false,
      filterMode: channels.filterMode,
      sortOrder: channels.sortOrder,
      setFilter,
      setSort,
    };
  }
  return null;
}
