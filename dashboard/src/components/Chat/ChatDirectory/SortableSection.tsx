import { useState, type CSSProperties, type ReactElement } from 'react';
import { Accordion } from 'radix-ui';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpDown,
  Check,
  ChevronRight,
  FolderPlus,
  GripVertical,
  ListChecks,
  ListTree,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react';
import { ChannelSortOrder, type ChannelSection } from '@xyne/shared';
import type { VisibleChannel } from '../../../machines/stateMachine';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../../utils/classNames';
import Badge from '../../ui/Badge';
import SortableChannelItem from './SortableChannelItem';
import { sumSectionUnread } from './ChatDirectory.utils';
import { renderEmoji } from '../../../utils/customEmojiUtils';

const SORT_OPTIONS: { label: string; value: ChannelSortOrder | null }[] = [
  { label: 'Unread & Activity', value: ChannelSortOrder.UNREAD },
  { label: 'By recency', value: ChannelSortOrder.RECENCY },
  { label: 'Alphabetical A-Z', value: ChannelSortOrder.ALPHABETICAL },
  { label: 'Manual order', value: null },
];

interface SortableSectionProps {
  section: ChannelSection;
  channels: VisibleChannel[];
  sections: ChannelSection[];
  unreadCounts: Record<string, number>;
  activeChannelId?: string | undefined;
  onRename: (section: ChannelSection) => void;
  onDelete: (section: ChannelSection) => void;
  onCreateSection: () => void;
  onManageChannels: (section: ChannelSection) => void;
  onMoveChannelToSection: (channelId: string, sectionId: string | null) => void;
  onSetSortOrder: (sectionId: string, order: ChannelSortOrder | null) => void;
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
  onManageChannels,
  onMoveChannelToSection,
  onSetSortOrder,
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

  const sectionUnreadCount = sumSectionUnread(channels, unreadCounts, activeChannelId);
  const currentSortOrder = section.sortOrder ?? null;

  return (
    <Accordion.Item
      ref={el => {
        setNodeRef(el);
        setDropNodeRef(el);
      }}
      style={style}
      value={section.id}
      className='group/item'
    >
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
          <button className='group/trigger flex items-center justify-start gap-2 flex-1 min-w-0 h-8 text-sidebar-secondary-foreground text-xs font-semibold px-1'>
            <span className='size-4 flex items-center justify-center shrink-0'>
              <span className='group-hover:hidden'>
                {section.emoji ? (
                  renderEmoji(section.emoji, 'size-4')
                ) : (
                  <ListTree className='size-3.5' />
                )}
              </span>
              <ChevronRight
                strokeWidth={2.33}
                className='size-3 hidden group-hover:block transition-transform duration-200 group-data-[state=open]/trigger:rotate-90'
              />
            </span>
            <span className='text-left truncate block'>{section.name}</span>
          </button>
        </Accordion.Trigger>
        {sectionUnreadCount > 0 && (
          <Badge className='order-last mr-0.5 hidden group-data-[state=closed]/item:inline-flex font-mono h-[18px] shrink-0 bg-sidebar-badge-accent px-1.5 text-sidebar-badge-accent-foreground'>
            {sectionUnreadCount > 9 ? '9+' : sectionUnreadCount}
          </Badge>
        )}
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
              <MoreVertical strokeWidth={2.33} className='size-3.5 shrink-0' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            onCloseAutoFocus={e => e.preventDefault()}
            className='min-w-[180px]'
          >
            <div className='flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-sidebar-secondary-foreground'>
              {section.emoji && renderEmoji(section.emoji, 'size-4')}
              <span className='truncate'>{section.name}</span>
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
              className='gap-2'
              onClick={e => {
                e.stopPropagation();
                onManageChannels(section);
              }}
            >
              <ListChecks className='size-3.5 shrink-0' />
              <span className='flex-1'>Manage channels</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className='gap-2'>
                <ArrowUpDown className='size-3.5 shrink-0' />
                <span className='flex-1'>Sort channels</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SORT_OPTIONS.map(opt => (
                  <DropdownMenuItem
                    key={opt.label}
                    className='gap-2'
                    onClick={e => {
                      e.stopPropagation();
                      onSetSortOrder(section.id, opt.value);
                    }}
                  >
                    <span className='flex-1'>{opt.label}</span>
                    {currentSortOrder === opt.value && <Check className='size-3.5 shrink-0' />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
        <div className='min-h-[4px]'>
          {channels.length === 0 ? (
            <div className='px-2 py-1 text-xs text-sidebar-secondary-foreground/60'>
              No channels yet
            </div>
          ) : (
            channels.map(channel => (
              <SortableChannelItem
                key={channel.id}
                channel={channel}
                unreadCount={unreadCounts[channel.id] ?? 0}
                isActive={activeChannelId === channel.id}
                sections={sections}
                onMoveToSection={onMoveChannelToSection}
              />
            ))
          )}
        </div>
      </Accordion.Content>
    </Accordion.Item>
  );
};

export default SortableSection;
