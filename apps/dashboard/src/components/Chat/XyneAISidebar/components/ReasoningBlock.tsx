import { useState } from 'react';
import type { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';

interface ReasoningBlockProps {
  text: string;
  streaming?: boolean | undefined;
}

export function ReasoningBlock({ text, streaming }: ReasoningBlockProps): ReactElement {
  const [expanded, setExpanded] = useState(false);

  // Count reasoning steps (rough approximation by splitting on newlines)
  const stepCount = text.split('\n').filter(line => line.trim().length > 0).length;

  return (
    <div className='group'>
      <button
        onClick={() => setExpanded(!expanded)}
        className='flex w-full items-center gap-2 py-1 text-left transition-colors hover:text-foreground'
        type='button'
        data-track-category='XyneAI'
        data-track-name='toggle-reasoning-block'
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />

        <div className='flex min-w-0 flex-1 items-center gap-2'>
          {/* Label */}
          <span className={`text-xs ${streaming ? 'text-blue-500' : 'text-muted-foreground'}`}>
            {streaming ? 'Thinking…' : 'Thought process'}
          </span>

          {/* Step count */}
          <span className='text-[10px] text-muted-foreground/70'>
            ({stepCount} {stepCount === 1 ? 'step' : 'steps'})
          </span>

          {/* Character count */}
          <span className='ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums'>
            {text.length} chars
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className='ml-3 border-l border-border pl-3 mt-1'>
          <pre className='overflow-auto whitespace-pre-wrap break-words py-1 font-mono text-[11px] text-muted-foreground leading-relaxed'>
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
