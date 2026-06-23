import { useEffect, useMemo, useRef } from 'react';
import { FormContextType, FormEntityType } from '@xyne/shared';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';

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
          .flatMap(f => f.formFields ?? [])
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
    if (!forms || boardIds.length === 0) return;
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
                : 'Fire only when at least one of these form fields changed. Empty matches any form field update.'}
        </span>
      </div>

      {boardGroups.length > 0 && (
        <div className='flex flex-col gap-3'>
          {boardGroups.map(({ boardId, boardName, fields }) => (
            <div key={boardId} className='flex flex-col gap-1'>
              <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                {boardName}
              </span>
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
          ))}
        </div>
      )}
    </div>
  );
}
