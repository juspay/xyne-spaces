import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { cn } from '../../utils/classNames';

interface CanvasCommentActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
  className?: string;
}

export function CanvasCommentActions({
  onEdit,
  onDelete,
  disabled = false,
  className,
}: CanvasCommentActionsProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='iconSm'
          disabled={disabled}
          className={cn('size-6 shrink-0 text-muted-foreground', className)}
          aria-label='Comment actions'
          title='Comment actions'
          data-track-category='CANVAS'
          data-track-name='OPEN_COMMENT_ACTIONS'
        >
          <MoreVertical className='size-[15px]' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='z-[100]'
        onEscapeKeyDown={event => event.stopPropagation()}
      >
        <DropdownMenuItem
          onSelect={onEdit}
          data-track-category='CANVAS'
          data-track-name='EDIT_COMMENT'
        >
          <Pencil className='size-4' />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          className='text-destructive focus:text-destructive'
          onSelect={onDelete}
          data-track-category='CANVAS'
          data-track-name='DELETE_COMMENT'
        >
          <Trash2 className='size-4' />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
