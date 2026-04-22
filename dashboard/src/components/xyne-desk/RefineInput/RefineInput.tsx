import { useState, type ReactElement } from 'react';
import { ArrowRight } from 'lucide-react';

interface RefineInputProps {
  onSubmit: (instruction: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const RefineInput = ({
  onSubmit,
  disabled = false,
  placeholder = 'Refine: make it shorter, add context...',
}: RefineInputProps): ReactElement => {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <div className='flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-muted/30'>
      <input
        type='text'
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        className='flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60 disabled:opacity-50'
        data-track-category='AIDraft'
        data-track-name='RefineInput'
      />
      <button
        type='button'
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
        aria-label='Send refinement'
        data-track-category='AIDraft'
        data-track-name='SubmitRefinement'
      >
        <ArrowRight size={14} />
      </button>
    </div>
  );
};
