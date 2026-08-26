import type { ReactElement } from 'react';
import { FolderAi, MultipleCrossCancelDefault } from '@xyne/icons';
import { Button } from '../../ui/Button';

interface ProjectSectionSuggestionCardProps {
  onAccept: () => void;
  onDismiss: () => void;
}

export const ProjectSectionSuggestionCard = ({
  onAccept,
  onDismiss,
}: ProjectSectionSuggestionCardProps): ReactElement => {
  return (
    <div
      className='mx-3 mb-4 rounded-lg border border-sidebar-accent-ring bg-sidebar-accent/40 p-3'
      data-testid='project-section-suggestion-card'
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground'>
          <FolderAi size={14} className='shrink-0 text-sidebar-primary' />
          <span>Organize your channels</span>
        </div>
        <button
          type='button'
          onClick={onDismiss}
          aria-label='Dismiss suggestion'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='DISMISS_SECTION_SUGGESTION'
          className='-mr-1 -mt-1 shrink-0 rounded p-0.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-item-hover hover:text-sidebar-foreground'
        >
          <MultipleCrossCancelDefault size={14} />
        </button>
      </div>

      <p className='mt-1.5 text-xs leading-relaxed text-sidebar-foreground/70'>
        Keep everything easier to find.
      </p>

      <div className='mt-2.5 flex items-center justify-end'>
        <Button
          type='button'
          variant='default'
          size='sm'
          onClick={onAccept}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='ACCEPT_SECTION_SUGGESTION'
          className='h-7 px-2.5 text-xs'
        >
          Try now
        </Button>
      </div>
    </div>
  );
};

export default ProjectSectionSuggestionCard;
