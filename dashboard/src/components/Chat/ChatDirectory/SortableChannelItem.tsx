import { memo, type CSSProperties, type ReactElement } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ChannelSection } from '@xyne/shared';
import type { VisibleChannel } from '../../../machines/stateMachine';
import ChannelItemV2 from './ChannelItemV2';

interface SortableChannelItemProps {
  channel: VisibleChannel;
  unreadCount: number;
  isActive: boolean;
  sections: ChannelSection[];
  onMoveToSection: (channelId: string, sectionId: string | null) => void;
}

const SortableChannelItem = memo(
  ({
    channel,
    unreadCount,
    isActive,
    sections,
    onMoveToSection,
  }: SortableChannelItemProps): ReactElement => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: channel.id,
      data: { type: 'channel' },
    });
    const style: CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0 : undefined,
    };

    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
        <ChannelItemV2
          channel={channel}
          unreadCount={unreadCount}
          isActive={isActive}
          sections={sections}
          onMoveToSection={onMoveToSection}
        />
      </div>
    );
  },
);

SortableChannelItem.displayName = 'SortableChannelItem';

export default SortableChannelItem;
