import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useChannelSections } from '@/src/hooks/useChannelSections';
import { toggleChannelGroupCollapse } from '@/src/hooks/useChannelGroupCollapse';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { haptics } from '@/src/utils/haptics';

import type { ChannelGroup } from '../model/layout';

export type ChannelActions = {
  toggleStar: (channelId: string) => void;
  /** Expands or collapses a group, persisting it wherever that group keeps it. */
  toggleGroup: (group: ChannelGroup) => void;
  /** `null` takes the channel out of its section. */
  moveToSection: (channelId: string, sectionId: string | null) => void;
  /** Creates the section, then moves the channels into it. */
  createSection: (name: string, channelIds: readonly string[]) => void;
  renameSection: (sectionId: string, name: string) => void;
  /** Channels in it fall back to the Channels group; the mutator detaches them. */
  deleteSection: (sectionId: string) => void;
  /** Moves `add` into the section and `remove` out of it. */
  updateSectionChannels: (
    sectionId: string,
    add: readonly string[],
    remove: readonly string[],
  ) => void;
  existingSectionNames: readonly string[];
};

const ChannelActionsContext = createContext<ChannelActions | null>(null);

/**
 * The screen's mutations, built once.
 *
 * Provided from the screen rather than called per row: `useChannelSections`
 * runs a live query, and a list of rows each subscribing to it would run one
 * per row for the same answer.
 */
export function ChannelActionsProvider({ children }: { children: ReactNode }): ReactElement {
  const zero = useZero();
  const {
    existingNames,
    createSection: createSectionRow,
    addChannelsToSection,
    removeChannelsFromSection,
    toggleCollapse,
    renameSection: renameSectionRow,
    deleteSection: deleteSectionRow,
  } = useChannelSections();

  const toggleStar = useCallback(
    (channelId: string) => {
      void haptics.toggleOn();
      void zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: Date.now() }));
    },
    [zero],
  );

  const toggleGroup = useCallback(
    (group: ChannelGroup) => {
      void haptics.buttonTap();
      if (group.kind === 'section') {
        toggleCollapse(group.id, group.isCollapsed);
      } else if (group.kind === 'channels') {
        toggleChannelGroupCollapse('channels');
      }
    },
    [toggleCollapse],
  );

  const moveToSection = useCallback(
    (channelId: string, sectionId: string | null) => {
      if (sectionId === null) {
        removeChannelsFromSection([channelId]);
      } else {
        addChannelsToSection([channelId], sectionId);
      }
    },
    [addChannelsToSection, removeChannelsFromSection],
  );

  const createSection = useCallback(
    (name: string, channelIds: readonly string[]) => {
      const sectionId = createSectionRow(name);
      if (channelIds.length > 0) addChannelsToSection([...channelIds], sectionId);
    },
    [addChannelsToSection, createSectionRow],
  );

  const renameSection = useCallback(
    (sectionId: string, name: string) => renameSectionRow(sectionId, name),
    [renameSectionRow],
  );

  const deleteSection = useCallback(
    (sectionId: string) => deleteSectionRow(sectionId),
    [deleteSectionRow],
  );

  const updateSectionChannels = useCallback(
    (sectionId: string, add: readonly string[], remove: readonly string[]) => {
      if (add.length > 0) addChannelsToSection([...add], sectionId);
      if (remove.length > 0) removeChannelsFromSection([...remove]);
    },
    [addChannelsToSection, removeChannelsFromSection],
  );

  const value = useMemo<ChannelActions>(
    () => ({
      toggleStar,
      toggleGroup,
      moveToSection,
      createSection,
      renameSection,
      deleteSection,
      updateSectionChannels,
      existingSectionNames: existingNames,
    }),
    [
      createSection,
      deleteSection,
      existingNames,
      moveToSection,
      renameSection,
      toggleGroup,
      toggleStar,
      updateSectionChannels,
    ],
  );

  return <ChannelActionsContext.Provider value={value}>{children}</ChannelActionsContext.Provider>;
}

export function useChannelActions(): ChannelActions {
  const value = useContext(ChannelActionsContext);
  if (value === null)
    throw new Error('useChannelActions must be used inside <ChannelActionsProvider>');
  return value;
}
