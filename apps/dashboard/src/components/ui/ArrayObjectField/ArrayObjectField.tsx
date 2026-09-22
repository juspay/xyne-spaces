import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { WorkflowFieldSchema } from '../../Tickets/types';
import { cn } from '../../../utils/classNames';
import Input from '../Input/Input';
import { Button } from '../Button/Button';

interface ArrayObjectFieldProps {
  field: WorkflowFieldSchema;
  value: Record<string, unknown>[];
  onChange: (value: Record<string, unknown>[]) => void;
  error?: string | undefined;
  className?: string;
}

export const ArrayObjectField: React.FC<ArrayObjectFieldProps> = ({
  field,
  value,
  onChange,
  error,
  className,
}) => {
  const items = Array.isArray(value) ? value : [];

  const handleCreateNew = () => {
    const newItem: Record<string, unknown> = {};
    if (field.nestedFields) {
      field.nestedFields.forEach(nf => {
        newItem[nf.name] = nf.defaultValue ?? '';
      });
    }
    onChange([...items, newItem]);
  };

  const handleRemove = (index: number) => {
    const next = [...items];
    next.splice(index, 1);
    onChange(next);
  };

  const handleChange = (index: number, key: string, targetValue: string | number) => {
    const next = [...items];
    next[index] = { ...next[index], [key]: targetValue };
    onChange(next);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {error && (
        <span className='text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1 duration-200'>
          {error}
        </span>
      )}

      {items.map((item, index) => {
        const isRowInvalid = field.nestedFields?.some(
          nf =>
            nf.required &&
            (item[nf.name] === undefined || item[nf.name] === null || item[nf.name] === ''),
        );
        const shouldShowRowError =
          error && isRowInvalid && error !== `${field.name} requires at least one item`;

        return (
          <div
            key={index}
            className={cn(
              'flex items-center gap-2 p-3 border rounded-md bg-input/10 dark:bg-input/5 relative group transition-all',
              shouldShowRowError
                ? 'border-destructive/40 shadow-[0_0_0_1px_rgba(239,68,68,0.1)]'
                : 'border-border/50 hover:border-border/80',
            )}
          >
            <div className='flex-1 grid grid-cols-2 gap-x-4 gap-y-1'>
              {field.nestedFields?.map(nf => {
                const isFieldEmpty =
                  item[nf.name] === undefined || item[nf.name] === null || item[nf.name] === '';
                const showFieldError =
                  error &&
                  nf.required &&
                  isFieldEmpty &&
                  error !== `${field.name} requires at least one item`;

                return (
                  <div key={nf.name} className='flex flex-col gap-0.5'>
                    <label
                      className={cn(
                        'text-[9px] font-bold uppercase tracking-widest transition-colors',
                        showFieldError ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {nf.name}
                      {nf.required && <span className='ml-0.5 text-destructive'>*</span>}
                    </label>
                    <Input
                      type={nf.type === 'number' ? 'number' : 'text'}
                      value={(item[nf.name] as string | number | undefined) || ''}
                      onChange={e => {
                        const val = nf.type === 'number' ? Number(e.target.value) : e.target.value;
                        handleChange(index, nf.name, val);
                      }}
                      placeholder={nf.description || `Enter ${nf.name}`}
                      className={cn(
                        'h-8 text-xs transition-all',
                        showFieldError &&
                          'border-destructive/60 focus-visible:ring-destructive/20 focus-visible:border-destructive',
                      )}
                    />
                  </div>
                );
              })}
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={() => handleRemove(index)}
              data-track-category='form'
              data-track-name='REMOVE_ARRAY_ITEM'
              className='h-8 w-8 text-muted-foreground hover:text-destructive transition-colors shrink-0'
              title='Remove item'
            >
              <Trash2 size={14} />
            </Button>
          </div>
        );
      })}

      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={handleCreateNew}
        data-track-category='form'
        data-track-name='ADD_ARRAY_ITEM'
        className={cn(
          'flex items-center self-start gap-1.5 text-[10px] h-7 px-2 font-semibold uppercase tracking-wider transition-all',
          error &&
            items.length === 0 &&
            'border-destructive/50 text-destructive hover:bg-destructive/10',
        )}
      >
        <Plus size={12} />
        Add Item
      </Button>
    </div>
  );
};
