import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight, TextQuote } from 'lucide-react';
import { openLink } from '../../../../utils/openLink';

export interface PageSelectionPreviewProps {
  selection: { text: string; url: string; title: string; provider?: string };
}

export function PageSelectionPreview({ selection }: PageSelectionPreviewProps): ReactElement {
  const [open, setOpen] = useState(false);
  const characters = selection.text.length;
  const words = selection.text.trim() ? selection.text.trim().split(/\s+/).length : 0;

  return (
    <div className='rounded-lg border border-border bg-secondary/30 text-xs'>
      <div className='flex items-center gap-2 px-2.5 py-1.5'>
        <TextQuote className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
        <button
          type='button'
          onClick={() => setOpen(value => !value)}
          data-track-category='AskAI'
          data-track-name='page-selection-expand'
          className='flex min-w-0 flex-1 items-center gap-1 text-left text-muted-foreground hover:text-foreground'
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className='h-3 w-3 shrink-0' aria-hidden='true' />
          ) : (
            <ChevronRight className='h-3 w-3 shrink-0' aria-hidden='true' />
          )}
          <span className='truncate font-medium text-foreground'>{selection.title}</span>
          <span className='shrink-0'>
            · {words} words, {characters} characters
          </span>
        </button>
        <button
          type='button'
          onClick={event => openLink(selection.url, event)}
          data-track-category='AskAI'
          data-track-name='page-selection-open'
          className='shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          title={selection.url}
        >
          Open
        </button>
      </div>
      {open ? (
        <pre className='max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2.5 py-2 font-sans text-xs text-foreground'>
          {selection.text}
        </pre>
      ) : (
        <p className='truncate px-2.5 pb-1.5 text-muted-foreground'>{selection.text}</p>
      )}
    </div>
  );
}
