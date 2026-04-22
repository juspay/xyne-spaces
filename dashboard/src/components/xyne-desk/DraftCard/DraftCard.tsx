import { type ReactElement } from 'react';
import { Check, X, Sparkles, Loader2 } from 'lucide-react';
import { RefineInput } from '../RefineInput/RefineInput';

interface DraftCardProps {
  draftContent: string;
  isStreaming: boolean;
  onAccept: () => void;
  onReject: () => void;
  onRefine: (instruction: string) => void;
}

export const DraftCard = ({
  draftContent,
  isStreaming,
  onAccept,
  onReject,
  onRefine,
}: DraftCardProps): ReactElement => {
  return (
    <div className='mx-4 mb-3 border border-border rounded-xl bg-background shadow-sm overflow-hidden'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30'>
        <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
          <Sparkles size={14} className='text-violet-500' />
          <span>AI Draft</span>
          {isStreaming && <Loader2 size={12} className='animate-spin text-muted-foreground' />}
        </div>
        {draftContent && (
          <div className='flex items-center gap-1'>
            <button
              type='button'
              onClick={onReject}
              className='size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors'
              aria-label='Reject draft'
              title='Reject draft'
              data-track-category='AIDraft'
              data-track-name='RejectDraft'
            >
              <X size={14} />
            </button>
            <button
              type='button'
              onClick={onAccept}
              disabled={isStreaming}
              className='size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-green-600 hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
              aria-label='Accept draft'
              title='Accept draft'
              data-track-category='AIDraft'
              data-track-name='AcceptDraft'
            >
              <Check size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Draft content */}
      <div className='px-4 py-3 max-h-[200px] overflow-y-auto'>
        <div className='text-sm text-foreground whitespace-pre-wrap leading-relaxed'>
          {draftContent || (
            <span className='text-muted-foreground italic'>Generating draft...</span>
          )}
          {isStreaming && (
            <span className='inline-block w-0.5 h-4 bg-foreground animate-pulse ml-0.5 align-text-bottom' />
          )}
        </div>
      </div>

      {/* Refine input - always present */}
      <div className='px-4 pb-3'>
        <RefineInput onSubmit={onRefine} disabled={isStreaming} />
      </div>
    </div>
  );
};
