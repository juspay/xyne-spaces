import { type ReactElement } from 'react';
import { PencilEditBox, PencilEdit, DeleteDustbin01, ThreeDotsMenuVertical } from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../ui/dropdown-menu';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { DEFAULT_PROJECT_ICON } from '../SidebarProjects/SidebarProjects.utils';
import type { ProjectDialogKind } from '../SidebarProjects/SidebarProjects.types';
import type { ChatProject } from '../../../services/XyneAI/XyneAISessionsV2Service';

export function ProjectHeader({
  project,
  chatCount,
  onNewChat,
  onOpenDialog,
}: {
  project: ChatProject;
  chatCount: number;
  onNewChat: () => void;
  onOpenDialog: (kind: ProjectDialogKind) => void;
}): ReactElement {
  return (
    <header className='flex flex-wrap items-start justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-3'>
        <span
          className='grid size-10 shrink-0 place-items-center rounded-xl bg-secondary/60'
          aria-hidden
        >
          {renderEmoji(project.icon ?? DEFAULT_PROJECT_ICON, 'w-6 h-6', 'text-xl')}
        </span>
        <div className='min-w-0'>
          <h1 className='truncate text-xl font-semibold text-foreground'>{project.name}</h1>
          <p className='text-xs text-muted-foreground'>
            {chatCount === 1 ? '1 chat' : `${chatCount} chats`}
          </p>
        </div>
      </div>

      <div className='flex shrink-0 items-center gap-2'>
        <button
          type='button'
          onClick={onNewChat}
          className='inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground transition-colors hover:bg-secondary/60'
          data-track-category='XyneAI'
          data-track-name='NEW_CHAT_IN_PROJECT'
          data-track-metadata={JSON.stringify({
            surface: 'project-home',
            projectId: project.id,
          })}
        >
          <PencilEditBox size={15} aria-hidden />
          New chat
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label={`Actions for ${project.name}`}
              className='grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground'
            >
              <ThreeDotsMenuVertical size={16} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-48'>
            <DropdownMenuItem className='gap-2' onClick={() => onOpenDialog('rename')}>
              <PencilEdit size={14} className='shrink-0' aria-hidden />
              <span className='flex-1'>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className='gap-2 text-destructive focus:text-destructive'
              onClick={() => onOpenDialog('delete')}
            >
              <DeleteDustbin01 size={14} className='shrink-0' aria-hidden />
              <span className='flex-1'>Delete project</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
