import { useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';
import { mutators } from '@/src/zero/mutators';
import { keyBetween } from '@/src/components/chat/channel-list/section-utils';
import type { ChannelSection } from '@xyne/shared';

export type UseChannelSectionsResult = {
  sections: readonly ChannelSection[];
  existingNames: string[];
  createSection: (name: string) => string;
  renameSection: (id: string, name: string, emoji?: string | null) => void;
  deleteSection: (id: string) => void;
  toggleCollapse: (id: string, isCollapsed: boolean) => void;
  addChannelsToSection: (channelIds: string[], sectionId: string) => void;
  removeChannelsFromSection: (channelIds: string[]) => void;
};

export function useChannelSections(): UseChannelSectionsResult {
  const zero = useZero();
  const [channelSections] = useCachedQuery(queries.userChannelSections({}));

  const sections = useMemo(() => channelSections ?? [], [channelSections]);

  const lastSectionPosition = useMemo(
    () => (sections.length > 0 ? (sections[sections.length - 1]?.position ?? null) : null),
    [sections],
  );

  const existingNames = useMemo(() => sections.map(s => s.name), [sections]);

  const createSection = useCallback(
    (name: string): string => {
      // `crypto.randomUUID` does not exist on React Native's global — the app
      // standardises on `uuid`, whose getRandomValues polyfill is already loaded.
      const id = uuidv4();
      void zero.mutate(
        mutators.channelSection.create({
          id,
          name: name.trim(),
          emoji: null,
          position: keyBetween(lastSectionPosition, null),
          timestamp: Date.now(),
        }),
      );
      return id;
    },
    [zero, lastSectionPosition],
  );

  const renameSection = useCallback(
    (id: string, name: string, emoji?: string | null): void => {
      void zero.mutate(
        mutators.channelSection.update({
          id,
          name: name.trim(),
          ...(emoji !== undefined ? { emoji: emoji || null } : {}),
          timestamp: Date.now(),
        }),
      );
    },
    [zero],
  );

  const deleteSection = useCallback(
    (id: string): void => {
      void zero.mutate(mutators.channelSection.remove({ id, timestamp: Date.now() }));
    },
    [zero],
  );

  const toggleCollapse = useCallback(
    (id: string, isCollapsed: boolean): void => {
      void zero.mutate(
        mutators.channelSection.update({
          id,
          isCollapsed: !isCollapsed,
          timestamp: Date.now(),
        }),
      );
    },
    [zero],
  );

  const addChannelsToSection = useCallback(
    (channelIds: string[], sectionId: string): void => {
      const timestamp = Date.now();
      let prevKey: string | null = null;
      for (const channelId of channelIds) {
        const position = keyBetween(prevKey, null);
        void zero.mutate(
          mutators.channel.moveToSection({
            channelId,
            sectionId,
            position,
            timestamp,
          }),
        );
        prevKey = position;
      }
    },
    [zero],
  );

  const removeChannelsFromSection = useCallback(
    (channelIds: string[]): void => {
      const timestamp = Date.now();
      for (const channelId of channelIds) {
        void zero.mutate(
          mutators.channel.moveToSection({
            channelId,
            sectionId: null,
            position: keyBetween(null, null),
            timestamp,
          }),
        );
      }
    },
    [zero],
  );

  return {
    sections,
    existingNames,
    createSection,
    renameSection,
    deleteSection,
    toggleCollapse,
    addChannelsToSection,
    removeChannelsFromSection,
  };
}

export type { ChannelSection };
