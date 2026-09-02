import { useState, forwardRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../ui/Button/Button';

interface RefineInputProps {
  onSubmit: (instruction: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const RefineInput = forwardRef<HTMLInputElement, RefineInputProps>(
  (
    { onSubmit, disabled = false, placeholder = 'Refine: make it shorter, add context...' },
    ref,
  ) => {
    const [value, setValue] = useState('');

    const handleSubmit = () => {
      const trimmed = value.trim();
      if (!trimmed || disabled) return;
      onSubmit(trimmed);
      setValue('');
    };

    return (
      <div className='relative'>
        <input
          ref={ref}
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
          className='w-full text-sm border border-border rounded-lg bg-muted/30 pl-3 pr-9 py-2 outline-none placeholder:text-muted-foreground/60 disabled:opacity-50'
          data-track-category='AIDraft'
          data-track-name='RefineInput'
        />
        <Button
          type='button'
          variant='ghost'
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className='absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
          aria-label='Send refinement'
          data-track-category='AIDraft'
          data-track-name='SubmitRefinement'
          trackId='refine_draft'
        >
          <ArrowRight size={14} />
        </Button>
      </div>
    );
  },
);
RefineInput.displayName = 'RefineInput';
