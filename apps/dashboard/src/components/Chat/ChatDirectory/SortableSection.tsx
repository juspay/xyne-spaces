import { useState, type CSSProperties, type ReactElement } from 'react';
import { Accordion } from 'radix-ui';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  FolderPlus,
  ListCheck,
  ListDefault,
  ThreeDotsMenuVertical,
  PencilEdit,
  DeleteDustbin02,
} from '@xyne/icons';
import { ChannelFilterMode, ChannelSortOrder, type ChannelSection } from '@xyne/shared';
import type { VisibleChannel } from '../../../machines/stateMachine';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../../utils/classNames';
import Badge from '../../ui/Badge';
import SortableChannelItem from './SortableChannelItem';
import SectionSettingsMenu, { MENU_ROW } from './SectionSettingsMenu';
import { DEFAULT_FILTER_MODE } from './ChatDirectory.utils';
import { renderEmoji } from '../../../utils/customEmojiUtils';

interface SortableSectionProps {
  section: ChannelSection;
  channels: VisibleChannel[];
  sections: ChannelSection[];
  unreadCounts: Record<string, number>;
  sectionUnreadCount: number;
  activeChannelId?: string | undefined;
  onRename: (section: ChannelSection) => void;
  onDelete: (section: ChannelSection) => void;
  onCreateSection: () => void;
  onManageChannels: (section: ChannelSection) => void;
  onMoveChannelToSection: (channelId: string, sectionId: string | null) => void;
  onSetSortOrder: (sectionId: string, order: ChannelSortOrder | null) => void;
  onSetFilterMode: (sectionId: string, mode: ChannelFilterMode) => void;
}

const SortableSection = ({
  section,
  channels,
  sections,
  unreadCounts,
  sectionUnreadCount,
  activeChannelId,
  onRename,
  onDelete,
  onCreateSection,
  onManageChannels,
  onMoveChannelToSection,
  onSetSortOrder,
  onSetFilterMode,
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

  const currentSortOrder = section.sortOrder ?? null;

  return (
    <Accordion.Item
      ref={el => {
        setNodeRef(el);
        setDropNodeRef(el);
      }}
      style={style}
      value={section.id}
      data-sidebar-section={section.id}
      className='group/item'
    >
      {/* The header itself is the drag handle: a click toggles the section, a
          drag (>5px, per the PointerSensor constraint) reorders it. */}
      <div className='group relative flex items-center justify-between gap-2'>
        <Accordion.Trigger asChild>
          <button
            {...attributes}
            {...listeners}
            className='group/trigger flex items-center justify-start gap-2 flex-1 min-w-0 h-7 text-sidebar-foreground text-xs font-semibold px-3 cursor-grab active:cursor-grabbing'
          >
            <span className='size-4 flex items-center justify-center shrink-0'>
              <span className='group-hover:hidden'>
                {section.emoji ? renderEmoji(section.emoji, 'size-4') : <ListDefault size={14} />}
              </span>
              <ChevronRight
                strokeWidth={2.33}
                size={12}
                className='hidden group-hover:block transition-transform duration-200 group-data-[state=open]/trigger:rotate-90'
              />
            </span>
            <span className='text-left truncate block'>{section.name}</span>
          </button>
        </Accordion.Trigger>
        {sectionUnreadCount > 0 && (
          <Badge className='order-last mr-0.5 hidden group-data-[state=closed]/item:inline-flex font-mono h-[18px] shrink-0 bg-sidebar-primary border border-sidebar-accent-ring px-1.5 text-sidebar-primary-foreground'>
            {sectionUnreadCount > 9 ? '9+' : sectionUnreadCount}
          </Badge>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex items-center justify-center p-1 mr-0.5 rounded-md hover:bg-sidebar-accent shrink-0 text-sidebar-foreground hover:text-sidebar-accent-foreground transition-opacity ease-in-out duration-300',
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              aria-label='Section options'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='SECTION_OPTIONS_MENU'
            >
              <ThreeDotsMenuVertical strokeWidth={2.33} size={14} className='shrink-0' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side='right'
            align='start'
            alignOffset={-4}
            sideOffset={8}
            onCloseAutoFocus={e => e.preventDefault()}
            className='min-w-[230px]'
          >
            <p className='flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 text-sm font-semibold text-popover-foreground'>
              {section.emoji && renderEmoji(section.emoji, 'size-4')}
              <span className='truncate'>{section.name}</span>
            </p>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={MENU_ROW}
              onClick={e => {
                e.stopPropagation();
                onRename(section);
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='RENAME_SECTION'
            >
              <span className='flex size-5 shrink-0 items-center justify-center'>
                <PencilEdit size={16} />
              </span>
              <span className='flex-1'>Rename section</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={MENU_ROW}
              onClick={e => {
                e.stopPropagation();
                onManageChannels(section);
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='MANAGE_SECTION_CHANNELS'
            >
              <span className='flex size-5 shrink-0 items-center justify-center'>
                <ListCheck size={16} />
              </span>
              <span className='flex-1'>Manage channels</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={MENU_ROW}
              onClick={e => {
                e.stopPropagation();
                onCreateSection();
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CREATE_SECTION'
            >
              <span className='flex size-5 shrink-0 items-center justify-center'>
                <FolderPlus size={16} />
              </span>
              <span className='flex-1'>New section</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <SectionSettingsMenu
              filterMode={section.filterMode ?? DEFAULT_FILTER_MODE}
              sortOrder={currentSortOrder}
              onSetFilter={mode => onSetFilterMode(section.id, mode)}
              onSetSort={order => onSetSortOrder(section.id, order)}
              showManualSort
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={cn(MENU_ROW, 'text-destructive focus:text-destructive')}
              onClick={e => {
                e.stopPropagation();
                onDelete(section);
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='DELETE_SECTION'
            >
              <span className='flex size-5 shrink-0 items-center justify-center'>
                <DeleteDustbin02 size={16} />
              </span>
              <span className='flex-1'>Delete section</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Accordion.Content>
        <div className='min-h-[4px]'>
          {channels.length === 0 ? (
            <div className='px-2 py-1 text-xs text-sidebar-foreground/60'>No channels yet</div>
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
