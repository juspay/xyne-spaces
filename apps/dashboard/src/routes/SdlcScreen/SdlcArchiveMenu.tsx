import type { ReactElement } from 'react';
import { ArchiveRestore, ArchiveX, Ellipsis } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../utils/classNames';

/** Archive/restore for a Hub Knowledge document or a Wiki page. Admins only. */
export function SdlcArchiveMenu(props: {
  title: string;
  archived: boolean;
  trackingScope: 'Wiki' | 'HubKnowledge';
  className?: string;
  onToggle: (archived: boolean) => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          // The row and the card both open the document on click.
          onClick={event => event.stopPropagation()}
          aria-label={`${props.archived ? 'Restore' : 'Archive'} ${props.title}`}
          data-track-category='SdlcHub'
          data-track-name={`${props.trackingScope}ArchiveMenuOpened`}
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            props.className,
          )}
        >
          <Ellipsis size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-40 rounded-xl p-1.5 shadow-sm'>
        <DropdownMenuItem
          onClick={event => {
            event.stopPropagation();
            props.onToggle(!props.archived);
          }}
          data-track-category='SdlcHub'
          data-track-name={`${props.trackingScope}${props.archived ? 'Restored' : 'Archived'}`}
        >
          {props.archived ? <ArchiveRestore size={15} /> : <ArchiveX size={15} />}
          {props.archived ? 'Restore' : 'Archive'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
