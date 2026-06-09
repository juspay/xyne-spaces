import { useState, type CSSProperties, type ReactElement } from 'react';
import { Accordion } from 'radix-ui';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { ChannelSection } from '@xyne/shared';
import type { VisibleChannel } from '../../../machines/stateMachine';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../../utils/classNames';
import SortableChannelItem from './SortableChannelItem';

interface SortableSectionProps {
  section: ChannelSection;
  channels: VisibleChannel[];
  sections: ChannelSection[];
  unreadCounts: Record<string, number>;
  activeChannelId?: string | undefined;
  onRename: (section: ChannelSection) => void;
  onDelete: (section: ChannelSection) => void;
  onCreateSection: () => void;
  onMoveChannelToSection: (channelId: string, sectionId: string | null) => void;
}

const SortableSection = ({
  section,
  channels,
  sections,
  unreadCounts,
  activeChannelId,
  onRename,
  onDelete,
  onCreateSection,
  onMoveChannelToSection,
}: SortableSectionProps): ReactElement => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    data: { type: 'section' },
  });
  // Drop zone over the section body, so a channel can be dropped into an empty section too.
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `section-drop-${section.id}`,
    data: { type: 'container' },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <Accordion.Item ref={setNodeRef} style={style} value={section.id}>
      {/* Only the label is the Accordion.Trigger; grip + menu are siblings (no nested button). */}
      <div className='group relative flex items-center justify-between gap-2'>
        <button
          type='button'
          {...attributes}
          {...listeners}
          aria-label='Drag to reorder section'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='DRAG_SECTION'
          className='absolute -left-3 top-1/2 -translate-y-1/2 shrink-0 flex items-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity text-sidebar-secondary-foreground'
        >
          <GripVertical className='size-3.5' />
        </button>
        <Accordion.Trigger asChild>
          <button className='group/trigger flex items-center justify-start gap-1 flex-1 min-w-0 h-8 text-sidebar-secondary-foreground text-xs font-medium'>
            {section.emoji && <span className='shrink-0'>{section.emoji}</span>}
            <span className='text-left truncate block'>{section.name}</span>
            <span className='size-4 flex items-center justify-center shrink-0'>
              <ChevronRight
                strokeWidth={2.33}
                className='size-3 transition-transform duration-200 group-data-[state=open]/trigger:rotate-90'
              />
            </span>
          </button>
        </Accordion.Trigger>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex items-center justify-center p-1 mr-0.5 rounded-md hover:bg-sidebar-item-hover shrink-0 text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground transition-opacity ease-in-out duration-300',
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              aria-label='Section options'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='SECTION_OPTIONS_MENU'
            >
              <MoreHorizontal strokeWidth={2.33} className='size-3.5 shrink-0' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            onCloseAutoFocus={e => e.preventDefault()}
            className='min-w-[180px]'
          >
            <div className='px-2 py-1.5 text-xs font-semibold text-sidebar-secondary-foreground truncate'>
              {section.emoji ? `${section.emoji} ` : ''}
              {section.name}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className='gap-2'
              onClick={e => {
                e.stopPropagation();
                onRename(section);
              }}
            >
              <Pencil className='size-3.5 shrink-0' />
              <span className='flex-1'>Rename section</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className='gap-2 text-destructive focus:text-destructive'
              onClick={e => {
                e.stopPropagation();
                onDelete(section);
              }}
            >
              <Trash2 className='size-3.5 shrink-0' />
              <span className='flex-1'>Delete section</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className='gap-2'
              onClick={e => {
                e.stopPropagation();
                onCreateSection();
              }}
            >
              <FolderPlus className='size-3.5 shrink-0' />
              <span className='flex-1'>New section</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Accordion.Content>
        <div ref={setDropNodeRef} className='min-h-[4px]'>
          {channels.length === 0 ? (
            <div className='px-2 py-1 text-xs text-sidebar-secondary-foreground/60'>
              No channels yet
            </div>
          ) : (
            <SortableContext items={channels.map(c => c.id)} strategy={verticalListSortingStrategy}>
              {channels.map(channel => (
                <SortableChannelItem
                  key={channel.id}
                  channel={channel}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                  isActive={activeChannelId === channel.id}
                  sections={sections}
                  onMoveToSection={onMoveChannelToSection}
                />
              ))}
            </SortableContext>
          )}
        </div>
      </Accordion.Content>
    </Accordion.Item>
  );
};

export default SortableSection;
