import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FormContextType, FormEntityType } from '@xyne/shared';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import { cn } from '../../../../utils/classNames';
import { resolveDisplayFormFields } from '../../../../utils/board/resolveDisplayFormFields';

interface TicketUpdatedFormFieldsSectionProps {
  boardIds: string[];
  formFieldIds: string[];
  onChange: (ids: string[]) => void;
}

interface BoardGroup {
  boardId: string;
  boardName: string;
  fields: { id: string; fieldName: string }[];
}

export function TicketUpdatedFormFieldsSection({
  boardIds,
  formFieldIds,
  onChange,
}: TicketUpdatedFormFieldsSectionProps): React.ReactElement {
  const [forms] = useCachedQuery(
    queries.getFormsByContextType({ contextType: FormContextType.BOARD }),
  );
  const [boards] = useCachedQuery(queries.getAllBoardsList());
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set());

  const boardNameMap = useMemo(() => {
    const map = new Map<string, string>();
    boards?.forEach(b => map.set(b.id, b.name));
    return map;
  }, [boards]);

  const boardGroups = useMemo((): BoardGroup[] => {
    if (!forms || boardIds.length === 0) return [];

    return boardIds
      .map(boardId => {
        const boardForms = forms.filter(f =>
          f.formContextMappings?.some(
            m => m.contextId === boardId && m.entityType === FormEntityType.TICKET,
          ),
        );
        const fields = boardForms
          .flatMap(f => resolveDisplayFormFields(f.id, [...(f.formFields ?? [])]))
          .map(f => ({ id: f.id, fieldName: f.fieldName }))
          .filter((f, i, arr) => arr.findIndex(t => t.id === f.id) === i);
        return {
          boardId,
          boardName: boardNameMap.get(boardId) ?? boardId,
          fields,
        };
      })
      .filter(g => g.fields.length > 0);
  }, [forms, boardIds, boardNameMap]);

  const formFieldIdsRef = useRef(formFieldIds);
  formFieldIdsRef.current = formFieldIds;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Prune formFieldIds that belong to boards no longer selected.
  // Bail out while forms are still loading to avoid wiping saved selections.
  useEffect(() => {
    if (!forms) return;
    const validIds = new Set(boardGroups.flatMap(g => g.fields.map(f => f.id)));
    const pruned = formFieldIdsRef.current.filter(id => validIds.has(id));
    if (pruned.length !== formFieldIdsRef.current.length) {
      onChangeRef.current(pruned);
    }
  }, [boardGroups, forms, boardIds]);

  const handleToggle = (fieldId: string, checked: boolean) => {
    if (checked) {
      onChange([...formFieldIds, fieldId]);
    } else {
      onChange(formFieldIds.filter(id => id !== fieldId));
    }
  };

  const handleSelectAll = (group: BoardGroup, checked: boolean) => {
    const fieldIds = group.fields.map(f => f.id);
    if (checked) {
      const next = [...formFieldIds, ...fieldIds.filter(id => !formFieldIds.includes(id))];
      onChange(next);
    } else {
      onChange(formFieldIds.filter(id => !fieldIds.includes(id)));
    }
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

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/40 px-3 py-3'>
      <div className='flex flex-col gap-0.5'>
        <span className='text-xs font-medium text-foreground'>Form Fields</span>
        <span className='text-[11px] text-muted-foreground'>
          {boardIds.length === 0
            ? 'Select a board above to see its form fields.'
            : !forms
              ? 'Loading form fields…'
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
            const selectedInBoard = fields.filter(f => formFieldIds.includes(f.id));
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
                  <div className='flex flex-col gap-0.5 px-2 pb-2'>
                    {fields.map(field => (
                      <div key={field.id} className='rounded-md px-1 py-0.5 hover:bg-accent/40'>
                        <Checkbox
                          checked={formFieldIds.includes(field.id)}
                          onChange={checked => handleToggle(field.id, checked)}
                          label={field.fieldName}
                        />
                      </div>
                    ))}
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
