import React, { useState } from 'react';
import { X } from 'lucide-react';
import { normalizeTagName } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

export interface TagChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  onDuplicate?: (tag: string) => void;
  id?: string;
  'data-track-category'?: string;
  'data-track-name'?: string;
}

export const TagChipInput: React.FC<TagChipInputProps> = ({
  value,
  onChange,
  placeholder,
  disabled,
  onDuplicate,
  id,
  ...trackingProps
}) => {
  const [inputValue, setInputValue] = useState('');

  const addTag = (raw: string) => {
    const tag = normalizeTagName(raw);
    if (!tag) return;
    if (value.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
      onDuplicate?.(tag);
      return;
    }
    onChange([...value, tag]);
    setInputValue('');
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div
      className={cn(
        'flex w-full flex-wrap items-center gap-1.5 rounded-[10px] border border-border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-desk-accent',
        disabled && 'opacity-50',
      )}
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className='flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-sm text-foreground'
        >
          {tag}
          {!disabled && (
            <button
              type='button'
              onClick={() => removeTag(index)}
              data-track-category='ENTITY_PICKER'
              data-track-name='REMOVE_TAG_CHIP'
              className='rounded p-0.5 hover:bg-accent'
              aria-label={`Remove ${tag}`}
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        type='text'
        value={inputValue}
        onChange={e => {
          const next = e.target.value;
          if (next.includes(',')) {
            const [before, ...rest] = next.split(',');
            addTag(before ?? '');
            setInputValue(rest.join(','));
          } else {
            setInputValue(next);
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTag(inputValue);
          } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
            removeTag(value.length - 1);
          }
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        className='min-w-[80px] flex-1 bg-transparent text-sm text-foreground placeholder:text-desk-helper focus:outline-none disabled:opacity-50'
        {...trackingProps}
      />
    </div>
  );
};
