import { useState, type ReactElement } from 'react';
import {
  ChevronBigDown,
  DeleteDustbin01,
  PencilEdit,
  PencilEditBox,
  ThreeDotsMenuVertical,
} from '@xyne/icons';
import { Popover } from '../../ui/Popover';
import { cn } from '../../../utils/classNames';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import type { ProjectRowProps } from './SidebarProjects.types';
import { DEFAULT_PROJECT_ICON } from './SidebarProjects.utils';

export function ProjectRow({
  project,
  isExpanded,
  onToggle,
  onOpen,
  onRename,
  onDelete,
  onNewChat,
}: ProjectRowProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        'group relative mt-px flex min-h-[46px] items-center gap-1 rounded-[10px] border border-transparent px-2.5 py-1.5 transition-colors',
        'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        menuOpen && 'bg-sidebar-accent',
      )}
      data-testid={`project-row-${project.id}`}
    >
      <button
        type='button'
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
        className='relative flex size-5 shrink-0 items-center justify-center rounded'
        data-track-category='XyneAI'
        data-track-name='TOGGLE_CHAT_PROJECT'
        data-track-metadata={JSON.stringify({ surface: 'page', projectId: project.id })}
      >
        <span
          className='transition-opacity group-focus-within:opacity-0 group-hover:opacity-0'
          aria-hidden
        >
          {renderEmoji(project.icon ?? DEFAULT_PROJECT_ICON, 'w-5 h-5', 'text-base')}
        </span>
        <ChevronBigDown
          size={12}
          className={cn(
            'absolute opacity-0 transition-[opacity,transform] duration-200 group-focus-within:opacity-100 group-hover:opacity-100',
            !isExpanded && '-rotate-90',
          )}
          aria-hidden
        />
      </button>

      <button
        type='button'
        onClick={onOpen}
        className='block min-w-0 flex-1 truncate py-1 pl-2.5 text-left text-sm'
        data-track-category='XyneAI'
        data-track-name='OPEN_CHAT_PROJECT'
        data-track-metadata={JSON.stringify({ surface: 'page', projectId: project.id })}
      >
        {project.name}
      </button>

      <button
        type='button'
        onClick={onNewChat}
        aria-label={`New chat in ${project.name}`}
        title={`New chat in ${project.name}`}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md p-1.5 opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 group-hover:opacity-100',
          'max-md:opacity-100',
          menuOpen && 'opacity-100',
        )}
        data-track-category='XyneAI'
        data-track-name='NEW_CHAT_IN_PROJECT'
        data-track-metadata={JSON.stringify({ surface: 'page', projectId: project.id })}
      >
        <PencilEditBox size={14} className='shrink-0' aria-hidden />
      </button>

      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        side='right'
        align='start'
        sideOffset={4}
        trigger={
          <button
            type='button'
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md p-1.5 opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 group-hover:opacity-100',
              'max-md:opacity-100',
              menuOpen && 'opacity-100',
            )}
            aria-label={`Options for ${project.name}`}
            data-track-category='XyneAI'
            data-track-name='OPEN_CHAT_PROJECT_MENU'
          >
            <ThreeDotsMenuVertical size={14} className='shrink-0' aria-hidden />
          </button>
        }
        className='w-48 rounded-lg border border-border bg-popover p-1.5 shadow-lg'
      >
        <button
          type='button'
          onClick={() => {
            setMenuOpen(false);
            onRename();
          }}
          className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent'
          data-track-category='XyneAI'
          data-track-name='RENAME_CHAT_PROJECT'
          data-track-metadata={JSON.stringify({ surface: 'page', projectId: project.id })}
        >
          <PencilEdit size={14} className='shrink-0' aria-hidden />
          <span>Rename</span>
        </button>
        <button
          type='button'
          onClick={() => {
            setMenuOpen(false);
            onDelete();
          }}
          className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-destructive hover:bg-accent'
          data-track-category='XyneAI'
          data-track-name='DELETE_CHAT_PROJECT'
          data-track-metadata={JSON.stringify({ surface: 'page', projectId: project.id })}
        >
          <DeleteDustbin01 size={14} className='shrink-0' aria-hidden />
          <span>Delete</span>
        </button>
      </Popover>
    </div>
  );
}
