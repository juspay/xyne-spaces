import React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type {
  ResponseSchemaField,
  StringField,
  NumberField,
  BooleanField,
  TextareaField,
  SelectField,
} from '@xyne/shared';
import type { UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { cn } from '../../../utils/classNames';

interface DynamicFormFieldProps {
  field: ResponseSchemaField;
  register: UseFormRegister<Record<string, unknown>>;
  setValue: UseFormSetValue<Record<string, unknown>>;
  error?: string;
}

const renderLabel = (htmlFor: string, label: string, required?: boolean): React.ReactNode => (
  <label htmlFor={htmlFor} className='block text-sm font-medium text-foreground mb-1.5'>
    {label}
    {required === true && <span className='text-destructive ml-0.5'>*</span>}
  </label>
);

const renderDescription = (description?: string): React.ReactNode =>
  description ? <p className='text-xs text-muted-foreground mt-1.5'>{description}</p> : null;

const renderError = (error?: string): React.ReactNode =>
  error ? (
    <p className='text-xs text-destructive mt-1.5 flex items-center gap-1'>
      <svg className='w-3 h-3' fill='currentColor' viewBox='0 0 20 20'>
        <path
          fillRule='evenodd'
          d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z'
          clipRule='evenodd'
        />
      </svg>
      {error}
    </p>
  ) : null;

const getInputClasses = (hasError: boolean): string =>
  cn(
    'w-full h-9 px-3 py-1 text-sm rounded-md border bg-transparent shadow-xs',
    'transition-[color,box-shadow] outline-none',
    'placeholder:text-muted-foreground',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    'dark:bg-input/30',
    hasError
      ? 'border-destructive ring-destructive/20 dark:ring-destructive/40'
      : 'border-input focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]',
  );

const StringFieldComponent: React.FC<{
  field: StringField;
  register: UseFormRegister<Record<string, unknown>>;
  error?: string;
}> = ({ field, register, error }) => (
  <div className='space-y-1'>
    {renderLabel(field.name, field.label, field.required)}
    <input
      id={field.name}
      type='text'
      className={getInputClasses(!!error)}
      placeholder={field.placeholder ?? ''}
      defaultValue={field.default ?? ''}
      {...register(field.name, {
        required: field.required === true ? `${field.label} is required` : false,
      })}
      data-track-category='Tickets'
      data-track-name='DynamicTextField'
      data-track-metadata={JSON.stringify({ fieldName: field.name })}
    />
    {renderDescription(field.description)}
    {renderError(error)}
  </div>
);

const NumberFieldComponent: React.FC<{
  field: NumberField;
  register: UseFormRegister<Record<string, unknown>>;
  error?: string;
}> = ({ field, register, error }) => (
  <div className='space-y-1'>
    {renderLabel(field.name, field.label, field.required)}
    <input
      id={field.name}
      type='number'
      className={`${getInputClasses(!!error)} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      placeholder={field.placeholder ?? ''}
      defaultValue={field.default ?? ''}
      {...register(field.name, {
        required: field.required === true ? `${field.label} is required` : false,
        valueAsNumber: true,
      })}
      data-track-category='Tickets'
      data-track-name='DynamicNumberField'
      data-track-metadata={JSON.stringify({ fieldName: field.name })}
    />
    {renderDescription(field.description)}
    {renderError(error)}
  </div>
);

const BooleanFieldComponent: React.FC<{
  field: BooleanField;
  register: UseFormRegister<Record<string, unknown>>;
  error?: string;
}> = ({ field, register, error }) => (
  <div className='space-y-1'>
    <label
      htmlFor={field.name}
      className='flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
    >
      <div className='flex-1 pr-4'>
        <span className='text-sm font-medium text-gray-700 dark:text-gray-200'>
          {field.label}
          {field.required === true && <span className='text-red-500 ml-0.5'>*</span>}
        </span>
        {field.description && (
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>{field.description}</p>
        )}
      </div>
      <div className='relative flex-shrink-0'>
        <input
          id={field.name}
          type='checkbox'
          className='sr-only peer'
          defaultChecked={field.default ?? false}
          {...register(field.name)}
          data-track-category='Tickets'
          data-track-name='DynamicBooleanField'
          data-track-metadata={JSON.stringify({ fieldName: field.name })}
        />
        <div className='w-11 h-6 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors' />
        <div className='absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-5' />
      </div>
    </label>
    {renderError(error)}
  </div>
);

const TextareaFieldComponent: React.FC<{
  field: TextareaField;
  register: UseFormRegister<Record<string, unknown>>;
  error?: string;
}> = ({ field, register, error }) => (
  <div className='space-y-1'>
    {renderLabel(field.name, field.label, field.required)}
    <textarea
      id={field.name}
      className={`${getInputClasses(!!error)} resize-none`}
      placeholder={field.placeholder ?? ''}
      defaultValue={field.default ?? ''}
      rows={field.rows ?? 4}
      {...register(field.name, {
        required: field.required === true ? `${field.label} is required` : false,
      })}
      data-track-category='Tickets'
      data-track-name='DynamicTextarea'
      data-track-metadata={JSON.stringify({ fieldName: field.name })}
    />
    {renderDescription(field.description)}
    {renderError(error)}
  </div>
);

const SelectFieldComponent: React.FC<{
  field: SelectField;
  register: UseFormRegister<Record<string, unknown>>;
  setValue: UseFormSetValue<Record<string, unknown>>;
  error?: string;
}> = ({ field, register, setValue, error }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Register the field with react-hook-form
  React.useEffect(() => {
    register(field.name, {
      required: field.required === true ? `${field.label} is required` : false,
    });
    if (field.default) {
      setValue(field.name, field.default);
      // Set display label for default value
      const defaultOption = field.options.find(o => o.value === field.default);
      setInputValue(defaultOption?.label || field.default);
    }
  }, [register, field.name, field.required, field.label, field.default, setValue, field.options]);

  // Filter options based on input value
  const filteredOptions = React.useMemo(() => {
    if (!field.allowCustomValue || !inputValue.trim()) return field.options;
    const lowerInput = inputValue.toLowerCase();
    return field.options.filter(
      opt =>
        opt.label.toLowerCase().includes(lowerInput) ||
        opt.value.toLowerCase().includes(lowerInput),
    );
  }, [field.options, field.allowCustomValue, inputValue]);

  const handleSelect = (value: string, label: string) => {
    setValue(field.name, value, { shouldValidate: true });
    setInputValue(label);
    setIsOpen(false);
  };

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue);
    setValue(field.name, newValue, { shouldValidate: true });
    // Only open dropdown if we have matching options
    if (field.allowCustomValue && newValue.trim()) {
      const hasMatches = field.options.some(
        opt =>
          opt.label.toLowerCase().includes(newValue.toLowerCase()) ||
          opt.value.toLowerCase().includes(newValue.toLowerCase()),
      );
      setIsOpen(hasMatches);
    } else {
      setIsOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredOptions.length > 0 && filteredOptions[0]) {
        handleSelect(filteredOptions[0].value, filteredOptions[0].label);
      }
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  if (field.allowCustomValue) {
    // Combobox mode: editable input with suggestions
    return (
      <div className='space-y-1'>
        {renderLabel(field.name, field.label, field.required)}

        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger asChild>
            <div className={cn(getInputClasses(!!error), 'flex items-center gap-2')}>
              <input
                ref={inputRef}
                type='text'
                value={inputValue}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={field.placeholder ?? 'Type or select...'}
                className='flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground min-w-0'
                data-track-category='Tickets'
                data-track-name='DynamicComboboxInput'
                data-track-metadata={JSON.stringify({ fieldName: field.name })}
              />
              <ChevronDown
                className={cn(
                  'w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 pointer-events-none',
                  isOpen && 'rotate-180',
                )}
              />
            </div>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={4}
              className='z-[100] w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover text-popover-foreground shadow-md'
              style={{
                maxHeight: 280,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
              }}
              onWheel={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
              onOpenAutoFocus={e => e.preventDefault()}
            >
              <div className='p-1'>
                {filteredOptions.map(option => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => handleSelect(option.value, option.label)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm rounded-sm',
                      'flex items-center gap-2 transition-colors',
                      'outline-none cursor-pointer',
                      'hover:bg-accent hover:text-accent-foreground',
                    )}
                    data-track-category='Tickets'
                    data-track-name='SelectDynamicFieldOption'
                    data-track-metadata={JSON.stringify({
                      value: option.value,
                      label: option.label,
                    })}
                  >
                    <span className='truncate flex-1'>{option.label}</span>
                  </button>
                ))}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {renderDescription(field.description)}
        {renderError(error)}
      </div>
    );
  }

  // Standard select mode: button trigger with options
  const selectedOption = field.options.find(o => o.value === inputValue);

  return (
    <div className='space-y-1'>
      {renderLabel(field.name, field.label, field.required)}

      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <button
            type='button'
            className={cn(
              getInputClasses(!!error),
              'w-full text-left flex items-center justify-between gap-2 cursor-pointer',
            )}
          >
            <span className={inputValue ? 'text-foreground truncate' : 'text-muted-foreground'}>
              {selectedOption?.label || (field.placeholder ?? 'Select an option...')}
            </span>
            <ChevronDown
              className={cn(
                'w-4 h-4 text-muted-foreground transition-transform flex-shrink-0',
                isOpen && 'rotate-180',
              )}
            />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={4}
            className='z-[100] w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover text-popover-foreground shadow-md'
            style={{
              maxHeight: 280,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
            onWheel={e => e.stopPropagation()}
            onTouchMove={e => e.stopPropagation()}
            onOpenAutoFocus={e => e.preventDefault()}
          >
            <div className='p-1'>
              {field.options.length === 0 ? (
                <div className='px-3 py-4 text-center'>
                  <p className='text-sm text-muted-foreground'>No options available</p>
                </div>
              ) : (
                field.options.map(option => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => handleSelect(option.value, option.label)}
                    className={cn(
                      'w-full px-2 py-1.5 text-left text-sm rounded-sm',
                      'flex items-center gap-2 transition-colors',
                      'outline-none cursor-pointer',
                      inputValue === option.value
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                    data-track-category='Tickets'
                    data-track-name='SelectMultiSelectOption'
                    data-track-metadata={JSON.stringify({
                      value: option.value,
                      label: option.label,
                    })}
                  >
                    <span className='w-4 h-4 flex items-center justify-center flex-shrink-0'>
                      {inputValue === option.value && <Check className='w-4 h-4 text-primary' />}
                    </span>
                    <span className='truncate flex-1'>{option.label}</span>
                  </button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {renderDescription(field.description)}
      {renderError(error)}
    </div>
  );
};

const DynamicFormField: React.FC<DynamicFormFieldProps> = ({
  field,
  register,
  setValue,
  error,
}) => {
  const errorProp = error !== undefined ? { error } : {};

  switch (field.type) {
    case 'string':
      return <StringFieldComponent field={field} register={register} {...errorProp} />;
    case 'number':
      return <NumberFieldComponent field={field} register={register} {...errorProp} />;
    case 'boolean':
      return <BooleanFieldComponent field={field} register={register} {...errorProp} />;
    case 'textarea':
      return <TextareaFieldComponent field={field} register={register} {...errorProp} />;
    case 'select':
      return (
        <SelectFieldComponent
          field={field}
          register={register}
          setValue={setValue}
          {...errorProp}
        />
      );
    default: {
      const _exhaustive: never = field;
      return (
        <div className='p-3 bg-destructive/10 border border-destructive/20 rounded-lg'>
          <p className='text-sm text-destructive'>
            Unknown field type: {(_exhaustive as ResponseSchemaField).type}
          </p>
        </div>
      );
    }
  }
};

export default DynamicFormField;
