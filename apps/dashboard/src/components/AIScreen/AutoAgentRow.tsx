import type { ReactElement, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { SELECTOR_ROW_CLASS, SELECTOR_ROW_SELECTED_CLASS } from './selectorStyles';
import { AUTO_LABEL } from './agentSearch';

interface AutoAgentRowProps {
  selected: boolean;
  onSelect: () => void;
  glyph: ReactNode;
  labelClassName: string;
}

export const AutoAgentRow = ({
  selected,
  onSelect,
  glyph,
  labelClassName,
}: AutoAgentRowProps): ReactElement => (
  <button
    onClick={onSelect}
    className={cn(SELECTOR_ROW_CLASS, 'justify-between', selected && SELECTOR_ROW_SELECTED_CLASS)}
    data-track-category='XyneAI'
    data-track-name='SELECT_AGENT'
    data-track-metadata={JSON.stringify({ agentSlug: 'auto' })}
  >
    <span className='flex min-w-0 items-center gap-2.5'>
      {glyph}
      <span className={labelClassName}>{AUTO_LABEL}</span>
    </span>
    {selected && <Check className='h-3.5 w-3.5 shrink-0' aria-hidden />}
  </button>
);
