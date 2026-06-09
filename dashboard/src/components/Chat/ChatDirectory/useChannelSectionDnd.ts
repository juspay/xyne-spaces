import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { ChannelType, type ChannelSection, type ChannelUserStatus } from '@xyne/shared';
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

const DEFAULT_CONTAINER = '__channels__';

interface UseChannelSectionDndParams {
  channels: VisibleChannel[];
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
  setDefaultDropRef: (element: HTMLElement | null) => void;
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
  channelData,
  allChannelsUserStatus,
}: UseChannelSectionDndParams): ChannelSectionDnd => {
  const zero = useZero();
  const [channelSections] = useCachedQuery(queries.userChannelSections({}));
  const { sectioned, unsectioned } = useMemo(
    () => bucketChannelsBySection(channels, allChannelsUserStatus, channelSections ?? []),
    [channels, allChannelsUserStatus, channelSections],
  );
  // Default-scope channels that can be placed into a section (DMs/email excluded).
  const sectionableChannels = useMemo(
    () =>
      (channelData ?? []).filter(c => !isDMChannel(c.scopeType) && c.type !== ChannelType.EMAIL),
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
  // Drop zone for the default "Channels" group, so channels can be dragged into/out of sections.
  const { setNodeRef: setDefaultDropRef } = useDroppable({
    id: `section-drop-${DEFAULT_CONTAINER}`,
    data: { type: 'container' },
  });
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null);
  // One cross-section re-parent per frame, to avoid an onDragOver feedback loop.
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
    return map;
  }, [sectioned, unsectioned]);
  // channelId -> persisted user status, so drag-end lookups are O(1) instead of repeated .find().
  const statusByChannelId = useMemo(() => {
    const map = new Map<string, ChannelUserStatus>();
    for (const s of allChannelsUserStatus) map.set(s.channelId, s);
    return map;
  }, [allChannelsUserStatus]);
  const displaySectioned = dragItems
    ? sectioned.map(bucket => ({
        section: bucket.section,
        channels: (dragItems[bucket.section.id] ?? [])
          .map(id => channelById.get(id))
          .filter((c): c is VisibleChannel => Boolean(c)),
      }))
    : sectioned;
  const defaultDisplayChannels = dragItems
    ? (dragItems[DEFAULT_CONTAINER] ?? [])
        .map(id => channelById.get(id))
        .filter((c): c is VisibleChannel => Boolean(c))
    : unsectioned;
  const activeOverlayChannel = activeDragId ? (channelById.get(activeDragId) ?? null) : null;
  const activeOverlaySection =
    activeDragId && !activeOverlayChannel
      ? ((channelSections ?? []).find(s => s.id === activeDragId) ?? null)
      : null;

  const moveChannelToSection = (channelId: string, sectionId: string | null): void => {
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
    void zero.mutate(
      mutators.channel.moveToSection({ channelId, sectionId, position, timestamp: Date.now() }),
    );
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
      for (const bucket of sectioned) items[bucket.section.id] = bucket.channels.map(c => c.id);
      items[DEFAULT_CONTAINER] = unsectioned.map(c => c.id);
      setDragItems(items);
    }
  };

  const handleDragOver = (event: DragOverEvent): void => {
    const { active, over } = event;
    if (!over) return;
    if ((active.data.current as { type?: string } | undefined)?.type !== 'channel') return;
    if (recentlyMovedToNewContainer.current || !dragItems) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeContainer = findContainer(activeId, dragItems);
    const overContainer = findContainer(overId, dragItems);
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;
    recentlyMovedToNewContainer.current = true;
    setDragItems(prev => {
      if (!prev) return prev;
      const overItems = prev[overContainer] ?? [];
      const overIndex = overItems.indexOf(overId);
      const newIndex = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...prev,
        [activeContainer]: (prev[activeContainer] ?? []).filter(id => id !== activeId),
        [overContainer]: [...overItems.slice(0, newIndex), activeId, ...overItems.slice(newIndex)],
      };
    });
  };

  const sidebarCollisionDetection: CollisionDetection = args => {
    const activeType = (args.active.data.current as { type?: string } | undefined)?.type;
    const droppableContainers = args.droppableContainers.filter(c => {
      if (c.id === args.active.id) return false;
      const t = (c.data.current as { type?: string } | undefined)?.type;
      return activeType === 'section' ? t === 'section' : t === 'channel' || t === 'container';
    });
    const scoped = { ...args, droppableContainers };
    if (activeType === 'section') return closestCenter(scoped);
    const under = pointerWithin(scoped);
    const onChannel = under.find(
      c =>
        (
          droppableContainers.find(d => d.id === c.id)?.data.current as
            | { type?: string }
            | undefined
        )?.type === 'channel',
    );
    if (onChannel) return [onChannel];
    if (under.length > 0) return under;
    return closestCenter(scoped);
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

    // --- Channel reorder / move ---
    if (activeData?.type === 'channel') {
      const channelId = String(active.id);
      const items = dragItems;
      if (!items) return;
      const finalContainer = findContainer(channelId, items);
      if (!finalContainer) return;
      const targetSectionId = finalContainer === DEFAULT_CONTAINER ? null : finalContainer;
      const currentSectionId = statusByChannelId.get(channelId)?.sectionId ?? null;
      // Reordering within the default "Channels" group isn't persisted (it follows the sort menu).
      if (targetSectionId === null && currentSectionId === null) return;
      const originalOrder = items[finalContainer] ?? [];
      let list = [...originalOrder];
      const activeIndex = list.indexOf(channelId);
      if (activeIndex < 0) return;
      if (overData?.type === 'channel') {
        const overIndex = list.indexOf(String(over.id));
        if (overIndex >= 0 && overIndex !== activeIndex) {
          list = arrayMove(list, activeIndex, overIndex);
        }
      } else {
        list = arrayMove(list, activeIndex, list.length - 1);
      }
      // No-op: same section and unchanged order → don't fire a mutation.
      const orderUnchanged =
        list.length === originalOrder.length && list.every((v, i) => v === originalOrder[i]);
      if (targetSectionId === currentSectionId && orderUnchanged) return;
      const idx = list.indexOf(channelId);
      const posOf = (id: string | undefined): string | null =>
        (id && statusByChannelId.get(id)?.sectionPosition) || null;
      const position =
        targetSectionId === null
          ? keyBetween(null, null)
          : keyBetween(posOf(list[idx - 1]), posOf(list[idx + 1]));
      void zero.mutate(
        mutators.channel.moveToSection({
          channelId,
          sectionId: targetSectionId,
          position,
          timestamp: Date.now(),
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
    setDefaultDropRef,
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
      },
    },
  };
};

export default useChannelSectionDnd;
