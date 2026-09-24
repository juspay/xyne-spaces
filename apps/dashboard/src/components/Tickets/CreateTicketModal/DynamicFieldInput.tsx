import React from 'react';
import { SelectMenuAlignment, SingleSelect } from '@juspay/blend-design-system';
import { FormFieldType, toSelectOptions, type User as UserType } from '@xyne/shared';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';
import { cn } from '../../../utils/classNames';
import Input from '../../ui/Input';
import MultiSelect from '../../ui/MultiSelect';
import RadioGroup, { Radio } from '../../ui/RadioGroup';
import { SearchUserV2 } from '../../ui/SearchUser/SearchUserV2';
import { TicketFieldSelector } from '../TicketFieldSelector/TicketFieldSelector';
import { Field, FieldError, FieldLabel } from '../../ui/Field/Field';

export type DynamicFieldValue = string | string[];

export interface DynamicFieldInputProps {
  field: ResolvedDisplayFormField;
  value: DynamicFieldValue;
  error?: string | undefined;
  onChange: (fieldName: string, value: DynamicFieldValue) => void;
  projectId?: string | undefined;
  allUsers: UserType[];
  userMap: Map<string, UserType>;
  searchQuery: string;
  onSearchChange: (fieldName: string, query: string) => void;
  isOpen: boolean;
  onOpenChange: (fieldName: string, open: boolean) => void;
}

const asString = (value: DynamicFieldValue): string =>
  Array.isArray(value) ? (value[0] ?? '') : value;

const asArray = (value: DynamicFieldValue): string[] =>
  Array.isArray(value) ? value : value ? [value] : [];

const fieldInput = (error?: string): string =>
  cn(
    'h-[34px] rounded-[9px] border bg-background px-[11px] text-[13px] text-foreground',
    'placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:border-foreground',
    error ? 'border-destructive bg-destructive/5' : 'border-input',
  );

const DynamicFieldInputBase: React.FC<DynamicFieldInputProps> = ({
  field,
  value,
  error,
  onChange,
  projectId,
  allUsers,
  userMap,
  searchQuery,
  onSearchChange,
  isOpen,
  onOpenChange,
}) => {
  const fieldName = field.fieldName;
  const required = field.isOptional !== true;
  const set = (next: DynamicFieldValue): void => onChange(fieldName, next);
  const stringValue = asString(value);
  const arrayValue = asArray(value);

  switch (field.fieldType) {
    case FormFieldType.STRING:
    case FormFieldType.NUMBER:
      return (
        <Field label={fieldName} required={required} error={error} className='gap-[5px]'>
          <Input
            value={stringValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value)}
            type={field.fieldType === FormFieldType.NUMBER ? 'number' : 'text'}
            placeholder={`Enter ${fieldName.toLowerCase()}`}
            aria-invalid={!!error}
            className={fieldInput(error)}
          />
        </Field>
      );

    case FormFieldType.DATE:
      return (
        <Field label={fieldName} required={required} error={error} className='gap-[5px]'>
          <Input
            value={stringValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value ?? '')}
            type='date'
            aria-invalid={!!error}
            className={fieldInput(error)}
          />
        </Field>
      );

    case FormFieldType.BOOLEAN:
      return (
        <div className='flex flex-col'>
          <RadioGroup
            label={fieldName}
            value={stringValue}
            className='text-xs'
            onChange={next => set(next)}
          >
            <div className='flex gap-3'>
              <Radio value='true'>Yes</Radio>
              <Radio value='false'>No</Radio>
            </div>
          </RadioGroup>
          <FieldError error={error} />
        </div>
      );

    case FormFieldType.SINGLE_SELECT:
      return (
        <SingleSelect
          label={fieldName}
          required={required}
          placeholder={`Select ${fieldName.toLowerCase()}`}
          items={[{ items: toSelectOptions(field.fieldEnum) }]}
          selected={stringValue}
          onSelect={selected => set(selected ?? '')}
          enableSearch
          searchPlaceholder='Search...'
          alignment={SelectMenuAlignment.START}
          error={!!error}
          {...(error && { errorMessage: error })}
        />
      );

    case FormFieldType.MULTI_SELECT:
      return (
        <Field label={fieldName} required={required} className='gap-[5px]'>
          <MultiSelect
            placeholder={`Select ${fieldName.toLowerCase()}`}
            options={toSelectOptions(field.fieldEnum)}
            selectedValues={arrayValue}
            onChange={next => set((next ?? []).filter(v => !!v && v.trim().length > 0))}
            error={error || ''}
          />
        </Field>
      );

    case FormFieldType.USER:
      return (
        <Field label={fieldName} required={required} error={error} className='gap-[5px]'>
          <div className='rounded border border-input'>
            <SearchUserV2
              options={allUsers}
              selectedUsers={arrayValue
                .map(userId => userMap.get(userId))
                .filter((user): user is UserType => user !== undefined)}
              searchQuery={searchQuery}
              onSearchChange={q => onSearchChange(fieldName, q)}
              onSelect={selectedUsers =>
                set(selectedUsers.map(u => u.id).filter(v => !!v && v.trim().length > 0))
              }
              isOpen={isOpen}
              setIsOpen={open => onOpenChange(fieldName, open)}
            />
          </div>
        </Field>
      );

    case FormFieldType.TICKET:
      return (
        <Field label={fieldName} required={required} error={error} className='gap-[5px]'>
          <div className='rounded border border-input'>
            <TicketFieldSelector
              selectedValue={stringValue || null}
              onSelect={ticketId => set(ticketId ?? '')}
              {...(projectId !== undefined && { projectId })}
              placeholder={`Search ${fieldName.toLowerCase()}`}
              testId={`ticket-field-selector-${fieldName}`}
            />
          </div>
        </Field>
      );

    case FormFieldType.DOC:
    default:
      return (
        <div className='flex flex-col'>
          <FieldLabel required={required}>{fieldName}</FieldLabel>
          <p className='mt-1 text-xs text-muted-foreground'>
            This field is filled in after the ticket is created.
          </p>
          <FieldError error={error} />
        </div>
      );
  }
};

export const DynamicFieldInput = React.memo(DynamicFieldInputBase);
