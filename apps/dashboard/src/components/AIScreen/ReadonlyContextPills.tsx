import { useState, type ReactElement } from 'react';
import {
  Hash,
  Ticket,
  FileText,
  Phone,
  BookOpen,
  Folder,
  Activity,
  Paperclip,
  ChevronLeft,
} from 'lucide-react';
import type { AttachedContextItem } from '../Chat/XyneAISidebar/components/ContextPickerPanel';
import { cn } from '../../utils/classNames';

/** Icon per attached-context type — mirrors the composer's pill row so a chip
 *  reads the same in the transcript as it did when the user attached it. Calls
 *  (transcripts + recordings both normalize to `call`) use the phone glyph.
 *  Typed as `string` because the persisted list can include backend-only types
 *  (`collection` | `folder` | `file` — merged in from KB items). */
function iconForType(type: string): ReactElement {
  const className = 'h-3.5 w-3.5 shrink-0 text-muted-foreground';
  switch (type) {
    case 'channel':
      return <Hash className={className} aria-hidden />;
    case 'ticket':
      return <Ticket className={className} aria-hidden />;
    case 'canvas':
      return <FileText className={className} aria-hidden />;
    case 'call':
      return <Phone className={className} aria-hidden />;
    case 'collection':
      return <BookOpen className={className} aria-hidden />;
    case 'folder':
      return <Folder className={className} aria-hidden />;
    case 'file':
      return <FileText className={className} aria-hidden />;
    case 'activity':
    default:
      return <Activity className={className} aria-hidden />;
  }
}

/** One read-only pill in the horizontal strip. */
function Pill({ item }: { item: AttachedContextItem }): ReactElement {
  return (
    <div
      className='flex h-6 max-w-[150px] flex-shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5'
      title={item.title}
    >
      {iconForType(item.type)}
      <span className='truncate text-[11.5px] font-medium text-foreground'>{item.title}</span>
    </div>
  );
}

/**
 * Collapsed, read-only summary of the context a user attached to a turn.
 * Rendered ABOVE the user message in the transcript so the attached context
 * survives a reload (persisted per message in claw-auth).
 *
 * Shows a compact chip — paperclip + item count + chevron. Clicking it expands,
 * to the LEFT of the chip, into a single-line horizontally-scrollable strip of
 * read-only pills (right-aligned, so it grows left and scrolls horizontally
 * rather than wrapping or covering the message).
 *
 * `expandedWidthClass` bounds the scrollable strip so it fits its surface —
 * pass a narrower value in the sidebar than on the full page.
 */
export function ReadonlyContextPills({
  items,
  className,
  expandedWidthClass = 'max-w-[28rem]',
}: {
  items: AttachedContextItem[];
  className?: string;
  /** Tailwind max-width for the expanded scrollable strip (surface-specific). */
  expandedWidthClass?: string;
}): ReactElement | null {
  const [open, setOpen] = useState(false);

  if (!items || items.length === 0) return null;

  return (
    <div className={cn('flex items-center justify-end gap-1', className)}>
      {open && (
        <div
          className={cn(
            'flex items-center gap-1 overflow-x-auto scrollbar-none',
            expandedWidthClass,
          )}
        >
          {items.map((item, index) => (
            <Pill key={`${item.type}-${item.id}-${index}`} item={item} />
          ))}
        </div>
      )}
      <button
        type='button'
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${items.length} attached context ${items.length === 1 ? 'item' : 'items'}`}
        title={`${items.length} attached context ${items.length === 1 ? 'item' : 'items'}`}
        className='flex h-6 flex-shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 text-[11.5px] font-medium text-muted-foreground transition hover:border-secondary hover:bg-secondary hover:text-foreground'
        data-track-category='XyneAI'
        data-track-name='TOGGLE_CONTEXT_PILLS'
      >
        <Paperclip className='h-3 w-3 shrink-0' aria-hidden />
        <span>{items.length}</span>
        <ChevronLeft
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
    </div>
  );
}
