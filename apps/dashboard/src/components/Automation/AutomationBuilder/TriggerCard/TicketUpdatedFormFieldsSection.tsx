import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FormFields, GlobalField } from '@xyne/shared';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import { cn } from '../../../../utils/classNames';
import { resolveDisplayFormFields } from '../../../../utils/board/resolveDisplayFormFields';

type MembershipRow = FormFields & { globalField?: GlobalField | null };

export type FormFieldConditionMatch = 'changed' | 'contains';

export interface FormFieldCondition {
  fieldId: string;
  match: FormFieldConditionMatch;
  value?: string;
}

interface TicketUpdatedFormFieldsSectionProps {
  boardIds: string[];
  formFieldConditions: FormFieldCondition[];
  onChange: (conditions: FormFieldCondition[]) => void;
  onFieldNamesResolved?: (map: Map<string, string>) => void;
}

interface BoardGroup {
  boardId: string;
  boardName: string;
  fields: { id: string; fieldName: string }[];
}

function conditionFor(
  conditions: FormFieldCondition[],
  fieldId: string,
): FormFieldCondition | undefined {
  return conditions.find(c => c.fieldId === fieldId);
}

export function TicketUpdatedFormFieldsSection({
  boardIds,
  formFieldConditions,
  onChange,
  onFieldNamesResolved,
}: TicketUpdatedFormFieldsSectionProps): React.ReactElement {
  // Scoped to selected boardIds — avoids fetching all board forms
  const [boardMappings] = useCachedQuery(queries.getFormMappingsByBoardIds({ boardIds }), {
    enabled: boardIds.length > 0,
  });
  // Stage transitions scoped to selected boards
  const [stageTransitions] = useCachedQuery(queries.getStageTransitionsByBoardIds({ boardIds }), {
    enabled: boardIds.length > 0,
  });
  const [boards] = useCachedQuery(queries.getAllBoardsList());
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set());

  const boardNameMap = useMemo(() => {
    const map = new Map<string, string>();
    boards?.forEach(b => map.set(b.id, b.name));
    return map;
  }, [boards]);

  type StageTransitionRow = NonNullable<typeof stageTransitions>[number];
  const stageTransitionsByBoardId = useMemo(() => {
    const map = new Map<string, StageTransitionRow[]>();
    stageTransitions?.forEach(t => {
      const existing = map.get(t.boardId);
      if (existing) existing.push(t);
      else map.set(t.boardId, [t]);
    });
    return map;
  }, [stageTransitions]);

  const boardGroups = useMemo((): BoardGroup[] => {
    if (boardIds.length === 0) return [];

    return boardIds
      .map(boardId => {
        const boardFields = (boardMappings ?? [])
          .filter(m => m.contextId === boardId)
          .flatMap(m => resolveDisplayFormFields(m.formId, (m.formFields ?? []) as MembershipRow[]))
          .map(f => ({ id: f.id, fieldName: f.fieldName }));

        const stageFields = (stageTransitionsByBoardId.get(boardId) ?? [])
          .filter(t => t.formId && t.form)
          .flatMap(t =>
            resolveDisplayFormFields(t.formId!, (t.form?.formFields ?? []) as MembershipRow[]),
          )
          .map(f => ({ id: f.id, fieldName: f.fieldName }));

        const fields = [...boardFields, ...stageFields].filter(
          (f, i, arr) => arr.findIndex(x => x.id === f.id) === i,
        );

        return { boardId, boardName: boardNameMap.get(boardId) ?? boardId, fields };
      })
      .filter(g => g.fields.length > 0);
  }, [boardMappings, stageTransitionsByBoardId, boardIds, boardNameMap]);

  const conditionsRef = useRef(formFieldConditions);
  conditionsRef.current = formFieldConditions;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onFieldNamesResolvedRef = useRef(onFieldNamesResolved);
  onFieldNamesResolvedRef.current = onFieldNamesResolved;

  useEffect(() => {
    if (!boardMappings || !stageTransitions) return;
    const validIds = new Set(boardGroups.flatMap(g => g.fields.map(f => f.id)));
    const pruned = conditionsRef.current.filter(c => validIds.has(c.fieldId));
    if (pruned.length !== conditionsRef.current.length) {
      onChangeRef.current(pruned);
    }
  }, [boardGroups, boardMappings, stageTransitions, boardIds]);

  const prevFieldNamesKeyRef = useRef<string>('');

  useEffect(() => {
    if (!onFieldNamesResolvedRef.current) return;
    if (!boardMappings) return;
    const map = new Map<string, string>();
    for (const group of boardGroups) {
      for (const field of group.fields) {
        map.set(field.id, field.fieldName);
      }
    }
    if (map.size === 0) return;
    const key = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, name]) => `${id}:${name}`)
      .join(',');
    if (key === prevFieldNamesKeyRef.current) return;
    prevFieldNamesKeyRef.current = key;
    onFieldNamesResolvedRef.current(map);
  }, [boardGroups, boardMappings]);

  const handleToggle = (fieldId: string, checked: boolean) => {
    if (checked) {
      onChange([
        ...formFieldConditions,
        {
          fieldId,
          match: 'changed',
          value: '',
        },
      ]);
    } else {
      onChange(formFieldConditions.filter(c => c.fieldId !== fieldId));
    }
  };

  const handleSelectAll = (group: BoardGroup, checked: boolean) => {
    const fieldIds = group.fields.map(f => f.id);
    if (checked) {
      const existing = new Set(formFieldConditions.map(c => c.fieldId));
      const additions = fieldIds
        .filter(id => !existing.has(id))
        .map(fieldId => ({
          fieldId,
          match: 'changed' as FormFieldConditionMatch,
          value: '',
        }));
      onChange([...formFieldConditions, ...additions]);
    } else {
      onChange(formFieldConditions.filter(c => !fieldIds.includes(c.fieldId)));
    }
  };

  const updateCondition = (
    fieldId: string,
    patch: Partial<Pick<FormFieldCondition, 'match' | 'value'>>,
  ) => {
    onChange(formFieldConditions.map(c => (c.fieldId === fieldId ? { ...c, ...patch } : c)));
  };

  const toggleBoard = (boardId: string) => {
    setExpandedBoards(prev => {
      const next = new Set(prev);
      if (next.has(boardId)) {
        next.delete(boardId);
      } else {
        next.add(boardId);
      }
      return next;
    });
  };

  const selectedIds = useMemo(
    () => new Set(formFieldConditions.map(c => c.fieldId)),
    [formFieldConditions],
  );

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/40 px-3 py-3'>
      <div className='flex flex-col gap-0.5'>
        <span className='text-xs font-medium text-foreground'>Form Fields</span>
        <span className='text-[11px] text-muted-foreground'>
          {boardIds.length === 0
            ? 'Select a board above to see its form fields.'
            : boardGroups.length === 0
              ? 'No form fields configured for the selected boards.'
              : 'Fire only when any of these form fields changed. Leave empty to skip form field tracking entirely.'}
        </span>
      </div>

      {boardGroups.length > 0 && (
        <div className='flex flex-col gap-1'>
          {boardGroups.map(group => {
            const { boardId, boardName, fields } = group;
            const isExpanded = expandedBoards.has(boardId);
            const selectedInBoard = fields.filter(f => selectedIds.has(f.id));
            const allSelected = selectedInBoard.length === fields.length;
            const someSelected = selectedInBoard.length > 0 && !allSelected;

            return (
              <div key={boardId} className='rounded-md border border-border/50 bg-background/30'>
                {/* Board header — clickable to collapse/expand */}
                <div
                  role='button'
                  tabIndex={0}
                  onClick={() => toggleBoard(boardId)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    toggleBoard(boardId);
                  }}
                  data-track-category='automation-builder'
                  data-track-name={`form-fields-toggle-${boardId}`}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left cursor-pointer',
                    'hover:bg-accent/40 rounded-md transition-colors',
                  )}
                >
                  {isExpanded ? (
                    <ChevronDown className='size-3.5 shrink-0 text-muted-foreground' />
                  ) : (
                    <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
                  )}
                  <span className='flex-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                    {boardName}
                  </span>
                  {/* Select all checkbox — stops propagation to prevent toggling the board collapse */}
                  <button
                    type='button'
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                    data-track-category='automation-builder'
                    data-track-name={`form-fields-select-all-${boardId}`}
                    className='flex items-center gap-1'
                  >
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={checked => handleSelectAll(group, checked)}
                      label='Select all'
                    />
                  </button>
                </div>

                {/* Field checkboxes — shown when expanded */}
                {isExpanded && (
                  <div className='flex flex-col gap-1 px-2 pb-2'>
                    {fields.map(field => {
                      const cond = conditionFor(formFieldConditions, field.id);
                      const checked = !!cond;
                      const match = cond?.match ?? 'changed';
                      return (
                        <div
                          key={field.id}
                          className='flex flex-col gap-1 rounded-md px-1 py-1 hover:bg-accent/40'
                        >
                          <Checkbox
                            checked={checked}
                            onChange={next => handleToggle(field.id, next)}
                            label={field.fieldName}
                          />
                          {checked && (
                            <div className='ml-6 flex flex-wrap items-center gap-2'>
                              <select
                                value={match}
                                onChange={e =>
                                  updateCondition(field.id, {
                                    match: e.target.value as FormFieldConditionMatch,
                                  })
                                }
                                className='h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground'
                                data-track-category='automation-builder'
                                data-track-name='form-field-match-operator'
                              >
                                <option value='changed'>Changed</option>
                                <option value='contains'>Contains</option>
                              </select>
                              {match === 'contains' && (
                                <input
                                  type='text'
                                  value={cond?.value ?? ''}
                                  onChange={e =>
                                    updateCondition(field.id, { value: e.target.value })
                                  }
                                  placeholder='Value contains…'
                                  className='h-7 min-w-[140px] flex-1 rounded-md border border-border bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground'
                                  data-track-category='automation-builder'
                                  data-track-name='form-field-contains-value'
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Convert legacy formFieldIds / formFieldConditions from trigger config. */
export function conditionsFromTriggerConfig(
  config: Record<string, unknown> | undefined,
): FormFieldCondition[] {
  if (!config) return [];
  const conditions = config['formFieldConditions'] as FormFieldCondition[] | undefined;
  if (conditions && conditions.length > 0) {
    return conditions.map(c => {
      const next: FormFieldCondition = {
        fieldId: c.fieldId,
        match: c.match ?? 'changed',
      };
      if (c.value !== undefined) next.value = c.value;
      return next;
    });
  }
  const ids = config['formFieldIds'] as string[] | undefined;
  if (ids && ids.length > 0) {
    return ids.map(fieldId => ({ fieldId, match: 'changed' as const }));
  }
  return [];
}
