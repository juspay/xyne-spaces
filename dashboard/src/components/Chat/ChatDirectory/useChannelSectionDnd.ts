import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ChannelScopeType,
  ChannelSortOrder,
  ChannelType,
  type ChannelSection,
  type ChannelUserStatus,
} from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import {
  bucketChannelsBySection,
  isDMChannel,
  keyBetween,
  suppressNextClick,
} from './ChatDirectory.utils';
import type { SectionBucket } from './ChatDirectory.types';
import type { VisibleChannel } from '../../../machines/stateMachine';

export const DEFAULT_CONTAINER = '__channels__';
export const STARRED_CONTAINER = '__starred__';
export const DM_CONTAINER = '__dms__';

interface UseChannelSectionDndParams {
  channels: VisibleChannel[];
  directMessages: VisibleChannel[];
  allDirectMessages: VisibleChannel[];
  starred: VisibleChannel[];
  channelData: VisibleChannel[] | undefined;
  allChannelsUserStatus: ChannelUserStatus[];
}

interface ChannelSectionDnd {
  channelSections: ChannelSection[] | undefined;
  sectioned: SectionBucket[];
  sectionableChannels: VisibleChannel[];
  lastSectionPosition: string | null;
  displaySectioned: SectionBucket[];
  defaultDisplayChannels: VisibleChannel[];
  dmDisplayChannels: VisibleChannel[];
  starredDisplayChannels: VisibleChannel[];
  activeOverlayChannel: VisibleChannel | null;
  activeOverlaySection: ChannelSection | null;
  moveChannelToSection: (channelId: string, sectionId: string | null) => void;
  dndContextProps: {
    sensors: ReturnType<typeof useSensors>;
    collisionDetection: CollisionDetection;
    onDragStart: (event: DragStartEvent) => void;
    onDragOver: (event: DragOverEvent) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onDragCancel: () => void;
  };
}

export const useChannelSectionDnd = ({
  channels,
  directMessages,
  allDirectMessages,
  starred,
  channelData,
  allChannelsUserStatus,
}: UseChannelSectionDndParams): ChannelSectionDnd => {
  const zero = useZero();
  const [channelSections] = useCachedQuery(queries.userChannelSections({}));
  const allSectionable = useMemo(
    () => [...channels, ...allDirectMessages],
    [channels, allDirectMessages],
  );
  const recentDmIds = useMemo(() => new Set(directMessages.map(c => c.id)), [directMessages]);
  const { sectioned, unsectioned } = useMemo(
    () => bucketChannelsBySection(allSectionable, allChannelsUserStatus, channelSections ?? []),
    [allSectionable, allChannelsUserStatus, channelSections],
  );
  const sectionableChannels = useMemo(
    () => (channelData ?? []).filter(c => c.type !== ChannelType.EMAIL),
    [channelData],
  );
  // Append new sections after the last one (channelSections is ordered by position asc).
  const lastSectionPosition =
    channelSections && channelSections.length > 0
      ? (channelSections[channelSections.length - 1]?.position ?? null)
      : null;
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null);
  const activeDragStartContainerRef = useRef<string | null>(null);
  const activeDragIsDmRef = useRef(false);
  const recentlyMovedToNewContainer = useRef(false);
  useEffect(() => {
    const raf = requestAnimationFrame((): void => {
      recentlyMovedToNewContainer.current = false;
    });
    return (): void => cancelAnimationFrame(raf);
  }, [dragItems]);
  const channelById = useMemo(() => {
    const map = new Map<string, VisibleChannel>();
    for (const bucket of sectioned) for (const c of bucket.channels) map.set(c.id, c);
    for (const c of unsectioned) map.set(c.id, c);
    for (const c of starred) map.set(c.id, c);
    return map;
  }, [sectioned, unsectioned, starred]);
  const statusByChannelId = useMemo(() => {
    const map = new Map<string, ChannelUserStatus>();
    for (const s of allChannelsUserStatus) map.set(s.channelId, s);
    return map;
  }, [allChannelsUserStatus]);
  const applySectionSort = (
    chs: VisibleChannel[],
    sortOrder: ChannelSortOrder | null | undefined,
    statuses: Map<string, ChannelUserStatus>,
  ): VisibleChannel[] => {
    if (!sortOrder) return chs;
    const sorted = [...chs];
    if (sortOrder === ChannelSortOrder.ALPHABETICAL) {
      return sorted.sort((a, b) =>
        (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase()),
      );
    }
    const lastActivity = (c: VisibleChannel) => c.channelStats?.lastActivityAt ?? 0;
    const lastViewed = (c: VisibleChannel) => statuses.get(c.id)?.lastViewedAt ?? 0;
    const unread = (c: VisibleChannel) => statuses.get(c.id)?.unreadCount ?? 0;
    if (sortOrder === ChannelSortOrder.RECENCY) {
      return sorted.sort((a, b) => lastActivity(b) - lastActivity(a));
    }
    return sorted.sort((a, b) => {
      const aUnread = unread(a) > 0 ? 2 : lastActivity(a) > lastViewed(a) ? 1 : 0;
      const bUnread = unread(b) > 0 ? 2 : lastActivity(b) > lastViewed(b) ? 1 : 0;
      if (bUnread !== aUnread) return bUnread - aUnread;
      return lastActivity(b) - lastActivity(a);
    });
  };

  const displaySectioned = dragItems
    ? sectioned.map(bucket => ({
        section: bucket.section,
        channels: (dragItems[bucket.section.id] ?? [])
          .map(id => channelById.get(id))
          .filter((c): c is VisibleChannel => Boolean(c)),
      }))
    : sectioned.map(bucket => ({
        section: bucket.section,
        channels: applySectionSort(bucket.channels, bucket.section.sortOrder, statusByChannelId),
      }));
  const defaultDisplayChannels = dragItems
    ? (dragItems[DEFAULT_CONTAINER] ?? [])
        .map(id => channelById.get(id))
        .filter((c): c is VisibleChannel => Boolean(c))
    : unsectioned.filter(c => c.scopeType === ChannelScopeType.DEFAULT);
  const dmDisplayChannels = dragItems
    ? (dragItems[DM_CONTAINER] ?? [])
        .map(id => channelById.get(id))
        .filter((c): c is VisibleChannel => Boolean(c))
    : unsectioned.filter(c => isDMChannel(c.scopeType) && recentDmIds.has(c.id));
  const starredDisplayChannels = dragItems
    ? (dragItems[STARRED_CONTAINER] ?? [])
        .map(id => channelById.get(id))
        .filter((c): c is VisibleChannel => Boolean(c))
    : starred;
  const activeOverlayChannel = activeDragId ? (channelById.get(activeDragId) ?? null) : null;
  const activeOverlaySection =
    activeDragId && !activeOverlayChannel
      ? ((channelSections ?? []).find(s => s.id === activeDragId) ?? null)
      : null;

  const moveChannelToSection = (channelId: string, sectionId: string | null): void => {
    const timestamp = Date.now();
    let position = keyBetween(null, null);
    if (sectionId) {
      const positions = allChannelsUserStatus
        .filter(s => s.sectionId === sectionId)
        .map(s => s.sectionPosition ?? '')
        .filter(p => p !== '')
        .sort();
      const lastPos = positions[positions.length - 1] ?? null;
      position = keyBetween(lastPos, null);
    }
    if (statusByChannelId.get(channelId)?.isStarred) {
      void zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: timestamp }));
    }
    void zero.mutate(mutators.channel.moveToSection({ channelId, sectionId, position, timestamp }));
  };

  const findContainer = (id: string, items: Record<string, string[]>): string | null => {
    if (id.startsWith('section-drop-')) {
      const sid = id.slice('section-drop-'.length);
      return items[sid] ? sid : null;
    }
    for (const sid of Object.keys(items)) {
      if ((items[sid] ?? []).includes(id)) return sid;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent): void => {
    const id = String(event.active.id);
    setActiveDragId(id);
    if ((event.active.data.current as { type?: string } | undefined)?.type === 'channel') {
      const items: Record<string, string[]> = {};
      for (const bucket of sectioned) {
        const sorted = applySectionSort(
          bucket.channels,
          bucket.section.sortOrder,
          statusByChannelId,
        );
        items[bucket.section.id] = sorted.map(c => c.id);
      }
      items[DEFAULT_CONTAINER] = unsectioned
        .filter(c => c.scopeType === ChannelScopeType.DEFAULT)
        .map(c => c.id);
      items[STARRED_CONTAINER] = starred.map(c => c.id);
      items[DM_CONTAINER] = unsectioned
        .filter(c => isDMChannel(c.scopeType) && recentDmIds.has(c.id))
        .map(c => c.id);
      const startContainer = Object.keys(items).find(k => (items[k] ?? []).includes(id)) ?? null;
      activeDragStartContainerRef.current = startContainer;
      const draggedChannel = channelById.get(id);
      activeDragIsDmRef.current = draggedChannel?.scopeType
        ? isDMChannel(draggedChannel.scopeType)
        : false;
      setDragItems(items);
    }
  };

  const handleDragOver = (event: DragOverEvent): void => {
    if ((event.active.data.current as { type?: string } | undefined)?.type === 'channel') return;
  };

  const sidebarCollisionDetection: CollisionDetection = args => {
    const activeType = (args.active.data.current as { type?: string } | undefined)?.type;
    const droppableContainers = args.droppableContainers.filter(c => {
      if (c.id === args.active.id) return false;
      const t = (c.data.current as { type?: string } | undefined)?.type;
      return activeType === 'section' ? t === 'section' : t === 'container';
    });
    return closestCenter({ ...args, droppableContainers });
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    suppressNextClick();
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as { type?: string } | undefined;
    const overData = over.data.current as { type?: string } | undefined;

    // --- Section reorder ---
    if (activeData?.type === 'section') {
      if (active.id === over.id || overData?.type !== 'section') return;
      const sorted = channelSections ?? [];
      const activeIndex = sorted.findIndex(s => s.id === active.id);
      const overIndex = sorted.findIndex(s => s.id === over.id);
      if (activeIndex === -1 || overIndex === -1) return;
      const without = sorted.filter(s => s.id !== active.id);
      const overPos = without.findIndex(s => s.id === over.id);
      let after: string | null;
      let before: string | null;
      if (activeIndex < overIndex) {
        after = without[overPos]?.position ?? null;
        before = without[overPos + 1]?.position ?? null;
      } else {
        before = without[overPos]?.position ?? null;
        after = without[overPos - 1]?.position ?? null;
      }
      void zero.mutate(
        mutators.channelSection.update({
          id: String(active.id),
          position: keyBetween(after, before),
          timestamp: Date.now(),
        }),
      );
      return;
    }

    if (activeData?.type === 'channel') {
      const channelId = String(active.id);
      const items = dragItems;
      if (!items) return;
      const wasStarred = statusByChannelId.get(channelId)?.isStarred === true;
      const timestamp = Date.now();

      if (wasStarred) {
        const overId = String(over.id);
        const targetContainer = overId.startsWith('section-drop-')
          ? overId.slice('section-drop-'.length)
          : (findContainer(overId, items) ?? STARRED_CONTAINER);

        if (targetContainer === STARRED_CONTAINER) return;

        void zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: timestamp }));
        if (targetContainer !== DEFAULT_CONTAINER && targetContainer !== DM_CONTAINER) {
          const positions = allChannelsUserStatus
            .filter(s => s.sectionId === targetContainer)
            .map(s => s.sectionPosition ?? '')
            .filter(p => p !== '')
            .sort();
          const position = keyBetween(positions[positions.length - 1] ?? null, null);
          void zero.mutate(
            mutators.channel.moveToSection({
              channelId,
              sectionId: targetContainer,
              position,
              timestamp,
            }),
          );
        }
        return;
      }

      const isDm = activeDragIsDmRef.current;

      if (isDm) {
        const overId = String(over.id);
        const targetContainer = overId.startsWith('section-drop-')
          ? overId.slice('section-drop-'.length)
          : (findContainer(overId, items) ?? activeDragStartContainerRef.current ?? DM_CONTAINER);
        const currentSectionId = statusByChannelId.get(channelId)?.sectionId ?? null;
        if (targetContainer === STARRED_CONTAINER) {
          void zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: timestamp }));
          void zero.mutate(
            mutators.channel.moveToSection({
              channelId,
              sectionId: null,
              position: keyBetween(null, null),
              timestamp,
            }),
          );
          return;
        }
        if (targetContainer === DM_CONTAINER) {
          if (currentSectionId) {
            void zero.mutate(
              mutators.channel.moveToSection({
                channelId,
                sectionId: null,
                position: keyBetween(null, null),
                timestamp,
              }),
            );
          }
          return;
        }
        if (targetContainer === DEFAULT_CONTAINER || targetContainer === currentSectionId) return;
        const dmPositions = allChannelsUserStatus
          .filter(s => s.sectionId === targetContainer)
          .map(s => s.sectionPosition ?? '')
          .filter(p => p !== '')
          .sort();
        const dmPosition = keyBetween(dmPositions[dmPositions.length - 1] ?? null, null);
        void zero.mutate(
          mutators.channel.moveToSection({
            channelId,
            sectionId: targetContainer,
            position: dmPosition,
            timestamp,
          }),
        );
        return;
      }

      const overId = String(over.id);
      const targetContainer = overId.startsWith('section-drop-')
        ? overId.slice('section-drop-'.length)
        : (findContainer(overId, items) ??
          activeDragStartContainerRef.current ??
          DEFAULT_CONTAINER);

      if (targetContainer === STARRED_CONTAINER) {
        void zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: timestamp }));
        void zero.mutate(
          mutators.channel.moveToSection({
            channelId,
            sectionId: null,
            position: keyBetween(null, null),
            timestamp,
          }),
        );
        return;
      }

      const targetSectionId =
        targetContainer === DEFAULT_CONTAINER || targetContainer === DM_CONTAINER
          ? null
          : targetContainer;
      const currentSectionId = statusByChannelId.get(channelId)?.sectionId ?? null;
      if (targetSectionId === null && currentSectionId === null) return;
      if (targetSectionId === currentSectionId) return;

      let position: string;
      if (targetSectionId === null) {
        position = keyBetween(null, null);
      } else {
        const sectionPositions = allChannelsUserStatus
          .filter(s => s.sectionId === targetSectionId)
          .map(s => s.sectionPosition ?? '')
          .filter(p => p !== '')
          .sort();
        position = keyBetween(sectionPositions[sectionPositions.length - 1] ?? null, null);
      }
      void zero.mutate(
        mutators.channel.moveToSection({
          channelId,
          sectionId: targetSectionId,
          position,
          timestamp,
        }),
      );
    }
  };

  return {
    channelSections,
    sectioned,
    sectionableChannels,
    lastSectionPosition,
    displaySectioned,
    defaultDisplayChannels,
    dmDisplayChannels,
    starredDisplayChannels,
    activeOverlayChannel,
    activeOverlaySection,
    moveChannelToSection,
    dndContextProps: {
      sensors: dndSensors,
      collisionDetection: sidebarCollisionDetection,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragEnd: (event: DragEndEvent): void => {
        handleDragEnd(event);
        setActiveDragId(null);
        // Defer one frame so the optimistic move lands before the live arrangement clears.
        requestAnimationFrame(() => setDragItems(null));
      },
      onDragCancel: (): void => {
        setActiveDragId(null);
        setDragItems(null);
        activeDragIsDmRef.current = false;
      },
    },
  };
};
