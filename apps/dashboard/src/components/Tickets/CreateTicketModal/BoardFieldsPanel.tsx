import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { User as UserType } from '@xyne/shared';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';
import { cn } from '../../../utils/classNames';
import { DynamicFieldInput, type DynamicFieldValue } from './DynamicFieldInput';

const isRequired = (field: ResolvedDisplayFormField): boolean => field.isOptional !== true;

type FieldGroup = ResolvedDisplayFormField[];

const toGroups = (fields: ResolvedDisplayFormField[]): FieldGroup[] => {
  const groups: FieldGroup[] = [];
  for (const field of fields) {
    if (field.parentOptionId && groups.length > 0) {
      groups[groups.length - 1]!.push(field);
    } else {
      groups.push([field]);
    }
  }
  return groups;
};

export const orderFieldsRequiredFirst = (
  fields: ResolvedDisplayFormField[],
): ResolvedDisplayFormField[] => {
  const groups = toGroups(fields);
  const required = groups.filter(group => group.some(isRequired));
  const optional = groups.filter(group => !group.some(isRequired));
  return [...required, ...optional].flat();
};

const applyFilters = (
  fields: ResolvedDisplayFormField[],
  query: string,
  requiredOnly: boolean,
): ResolvedDisplayFormField[] => {
  const needle = query.trim().toLowerCase();
  const groups = toGroups(fields);

  return groups
    .filter(group => !needle || group.some(f => f.fieldName.toLowerCase().includes(needle)))
    .flatMap(group => {
      if (!requiredOnly) return group;
      const kept = group.filter(isRequired);
      if (kept.length === 0) return [];
      const head = group[0]!;
      return kept.includes(head) ? kept : [head, ...kept];
    });
};

export interface BoardFieldsPanelProps {
  fields: ResolvedDisplayFormField[];
  values: Record<string, DynamicFieldValue>;
  errors: Record<string, string>;
  onFieldChange: (fieldName: string, value: DynamicFieldValue) => void;
  registerFieldRef: (fieldName: string, el: HTMLDivElement | null) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  projectId?: string | undefined;
  allUsers: UserType[];
  userMap: Map<string, UserType>;
  searchQueries: Record<string, string>;
  onSearchQueryChange: (fieldName: string, query: string) => void;
  openStates: Record<string, boolean>;
  onOpenStateChange: (fieldName: string, open: boolean) => void;
}

export const BoardFieldsPanel: React.FC<BoardFieldsPanelProps> = ({
  fields,
  values,
  errors,
  onFieldChange,
  registerFieldRef,
  scrollRef,
  projectId,
  allUsers,
  userMap,
  searchQueries,
  onSearchQueryChange,
  openStates,
  onOpenStateChange,
}) => {
  const reduceMotion = useReducedMotion();
  const query = '';
  const [requiredOnly, setRequiredOnly] = useState(false);

  const ordered = useMemo(() => orderFieldsRequiredFirst(fields), [fields]);
  const requiredCount = useMemo(() => fields.filter(isRequired).length, [fields]);
  const showRequiredOnly = requiredOnly && requiredCount > 0;
  const shown = useMemo(
    () => applyFilters(ordered, query, showRequiredOnly),
    [ordered, query, showRequiredOnly],
  );
  const segment = (label: string, active: boolean, onClick: () => void): React.ReactElement => (
    <button
      type='button'
      onClick={onClick}
      data-track-category='Tickets'
      data-track-name='FILTER_BOARD_FIELDS'
      data-track-metadata={JSON.stringify({ filter: label })}
      className={cn(
        'flex h-[22px] items-center whitespace-nowrap rounded-full px-[11px] text-[11px] font-semibold transition-colors',
        active
          ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(20,22,26,.10)]'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className='flex min-h-0 flex-col'>
      <div className='flex shrink-0 flex-col gap-2 px-[18px] pb-[10px] pt-[14px]'>
        <span className='text-[13.5px] font-semibold text-foreground'>Additional fields</span>
        <div className='flex items-center gap-2'>
          <span className='whitespace-nowrap text-[11.5px] text-muted-foreground'>
            {fields.length} {fields.length === 1 ? 'field' : 'fields'}
          </span>
          <div className='flex-1' />
          {requiredCount > 0 && (
            <div className='flex items-center gap-0.5 rounded-full bg-muted p-0.5'>
              {segment('All', !showRequiredOnly, () => setRequiredOnly(false))}
              {segment('Required', showRequiredOnly, () => setRequiredOnly(true))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className='no-scrollbar flex min-h-0 max-h-[440px] flex-1 flex-col gap-3 overflow-y-auto px-[18px] pb-[18px] pt-1'
      >
        <AnimatePresence initial={false}>
          {shown.length === 0 ? (
            <p className='pt-6 text-center text-[12.5px] text-muted-foreground'>
              No fields match “{query}”
            </p>
          ) : (
            shown.map((field, index) => (
              <motion.div
                key={field.id}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut', delay: Math.min(index, 8) * 0.015 }}
                ref={el => registerFieldRef(field.fieldName, el)}
              >
                <DynamicFieldInput
                  field={field}
                  value={values[field.fieldName] ?? ''}
                  {...(errors[field.fieldName] !== undefined && { error: errors[field.fieldName] })}
                  onChange={onFieldChange}
                  {...(projectId !== undefined && { projectId })}
                  allUsers={allUsers}
                  userMap={userMap}
                  searchQuery={searchQueries[field.fieldName] ?? ''}
                  onSearchChange={onSearchQueryChange}
                  isOpen={openStates[field.fieldName] ?? false}
                  onOpenChange={onOpenStateChange}
                />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
