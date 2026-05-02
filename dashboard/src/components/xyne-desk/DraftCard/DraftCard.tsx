import { type ReactElement } from 'react';
import { Check, X, Sparkles, Loader2, Square } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { RefineInput } from '../RefineInput/RefineInput';
import { aiMarkdownProseClassName } from '../../../utils/markdownStyles';

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
    <div
      className='rounded-2xl p-px overflow-hidden flex flex-col h-full min-h-0'
      style={{
        background: isStreaming
          ? 'linear-gradient(135deg, #FFB3B3, #FFCECE, #FFC0C0, #FFB3B3)'
          : 'linear-gradient(135deg, rgba(255,179,179,0.3), rgba(255,206,206,0.15), rgba(255,179,179,0.3))',
        backgroundSize: isStreaming ? '300% 300%' : '100% 100%',
        animation: isStreaming ? 'gradient-xy 3s ease infinite' : 'none',
      }}
    >
      <div className='rounded-[calc(1rem-1px)] bg-background/95 dark:bg-background/90 backdrop-blur-xl overflow-hidden flex flex-col h-full min-h-0'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-2.5 min-h-[3rem] flex-shrink-0'>
          <div className='flex items-center gap-2.5'>
            <div
              className='relative flex items-center justify-center w-6 h-6 rounded-lg'
              style={{ background: '#F87171' }}
            >
              <Sparkles size={12} className='text-white' />
            </div>
            <span className='text-sm font-bold text-foreground'>AI Draft</span>
            {isStreaming && <Loader2 size={12} className='animate-spin text-muted-foreground' />}
          </div>
          <div className='flex items-center gap-1'>
            {isStreaming ? (
              <button
                type='button'
                onClick={onReject}
                className='inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors'
                aria-label='Stop generating'
                title='Stop generating'
                data-track-category='AIDraft'
                data-track-name='StopDraft'
              >
                <Square size={11} className='fill-current' />
                <span>Stop</span>
              </button>
            ) : (
              <>
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
                  disabled={!draftContent}
                  className='size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-green-600 hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                  aria-label='Accept draft'
                  title='Accept draft'
                  data-track-category='AIDraft'
                  data-track-name='AcceptDraft'
                >
                  <Check size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Draft content */}
        <div className='px-4 py-3 flex-1 min-h-0 overflow-y-auto'>
          {draftContent ? (
            <div className={aiMarkdownProseClassName}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{draftContent}</Markdown>
              {isStreaming && (
                <span className='inline-block w-0.5 h-4 bg-foreground animate-pulse ml-0.5 align-text-bottom' />
              )}
            </div>
          ) : (
            <div className='text-sm text-muted-foreground italic leading-relaxed'>
              Generating draft...
              {isStreaming && (
                <span className='inline-block w-0.5 h-4 bg-foreground animate-pulse ml-0.5 align-text-bottom' />
              )}
            </div>
          )}
        </div>

        {/* Refine input - always present */}
        <div className='px-4 pb-3 flex-shrink-0'>
          <RefineInput onSubmit={onRefine} disabled={isStreaming} />
        </div>
      </div>
    </div>
  );
};
