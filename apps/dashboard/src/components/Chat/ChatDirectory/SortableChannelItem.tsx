import { memo, type CSSProperties, type ReactElement } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { ChannelSection } from '@xyne/shared';
import type { VisibleChannel } from '../../../machines/stateMachine';
import ChannelItemV2 from './ChannelItemV2';

interface SortableChannelItemProps {
  channel: VisibleChannel;
  unreadCount: number;
  isActive: boolean;
  sections?: ChannelSection[];
  onMoveToSection?: (channelId: string, sectionId: string | null) => void;
}

const SortableChannelItem = memo(
  ({
    channel,
    unreadCount,
    isActive,
    sections,
    onMoveToSection,
  }: SortableChannelItemProps): ReactElement => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
      id: channel.id,
      data: { type: 'channel' },
    });
    const style: CSSProperties = {
      opacity: isDragging ? 0 : undefined,
    };

    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
        <ChannelItemV2
          channel={channel}
          unreadCount={unreadCount}
          isActive={isActive}
          {...(sections !== undefined && { sections })}
          {...(onMoveToSection !== undefined && { onMoveToSection })}
        />
      </div>
    );
  },
);

SortableChannelItem.displayName = 'SortableChannelItem';

export default SortableChannelItem;
