import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { FormFields, GlobalField } from '@xyne/shared';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';
import { VariableAwareInput } from '../SchemaForm/VariableAwareInput';
import type { SchemaFormProps } from '../SchemaForm/SchemaForm.types';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import { resolveDisplayFormFields } from '../../../../utils/board/resolveDisplayFormFields';

type MembershipRow = FormFields & { globalField?: GlobalField | null };

export interface CreateTicketFormFieldRow {
  fieldName: string;
  value?: string | null;
}

const FORM_FIELDS_KEY = 'formFields';
const VARIABLE_REF = /^\{\{.*\}\}$/;

/** A board id typed literally (not a {{variable}}) — only then can we look up its form. */
export function literalBoardId(boardId: unknown): string | null {
  if (typeof boardId !== 'string') return null;
  const trimmed = boardId.trim();
  if (!trimmed || VARIABLE_REF.test(trimmed)) return null;
  return trimmed;
}

/** Sets (or clears, when value is empty) one field in the formFields list, keeping order. */
export function upsertFormFieldRow(
  rows: CreateTicketFormFieldRow[],
  fieldName: string,
  value: string,
): CreateTicketFormFieldRow[] {
  const exists = rows.some(r => r.fieldName === fieldName);
  if (!value) return rows.filter(r => r.fieldName !== fieldName);
  if (exists) return rows.map(r => (r.fieldName === fieldName ? { ...r, value } : r));
  return [...rows, { fieldName, value }];
}

/**
 * CREATE_TICKET form. Renders the generic schema fields (board, title, ticket type …)
 * and replaces the raw `formFields` array with the selected board's own form fields,
 * so the author fills e.g. branch / deployedCommitId / newCommitId by name instead of
 * typing field names. Fields the board doesn't know about stay editable as custom rows.
 */
export function CreateTicketStepForm(props: SchemaFormProps): React.ReactElement {
  const root = resolveSchema(props.schema);
  const properties = Object.fromEntries(
    Object.entries(root.properties ?? {}).filter(([key]) => key !== FORM_FIELDS_KEY),
  );
  const supportsFormFields = FORM_FIELDS_KEY in (root.properties ?? {});

  const rows = useMemo<CreateTicketFormFieldRow[]>(
    () =>
      Array.isArray(props.value[FORM_FIELDS_KEY])
        ? (props.value[FORM_FIELDS_KEY] as CreateTicketFormFieldRow[])
        : [],
    [props.value],
  );
  const boardId = literalBoardId(props.value.boardId);

  const [mappings] = useCachedQuery(queries.getFormMappingsByBoardIds({ boardIds: boardId ? [boardId] : [] }), {
    enabled: !!boardId,
  });
  const boardFieldNames = useMemo(() => {
    const names = (mappings ?? [])
      .filter(m => m.contextId === boardId)
      .flatMap(m => resolveDisplayFormFields(m.formId, (m.formFields ?? []) as MembershipRow[]))
      .map(f => f.fieldName);
    return [...new Set(names)];
  }, [mappings, boardId]);

  const customRows = rows.filter(r => !boardFieldNames.includes(r.fieldName));
  const setRows = (next: CreateTicketFormFieldRow[]): void =>
    props.onChange({ ...props.value, [FORM_FIELDS_KEY]: next.length > 0 ? next : undefined });
  const valueOf = (name: string): string => String(rows.find(r => r.fieldName === name)?.value ?? '');
  const sources = props.variableSources ?? [];

  return (
    <div className='flex flex-col gap-4'>
      <SchemaForm {...props} schema={{ ...root, properties }} />
      {supportsFormFields && (
        <div className='flex flex-col gap-2' data-testid='create-ticket-form-fields'>
          <div className='flex flex-col gap-0.5'>
            <span className='text-xs font-medium text-foreground'>Ticket form fields</span>
            <span className='text-[11px] text-muted-foreground'>
              Values saved on the ticket when it is created. Release tickets need branch,
              deployedCommitId and newCommitId to start commit analysis. Supports {'{{…}}'} variables.
            </span>
          </div>

          {!boardId && (
            <span className='text-[11px] text-muted-foreground'>
              Pick a board above to see its form fields.
            </span>
          )}
          {boardId && mappings && boardFieldNames.length === 0 && (
            <span className='text-[11px] text-muted-foreground'>This board has no form fields.</span>
          )}

          {boardFieldNames.map(name => (
            <div key={name} className='flex items-center gap-2'>
              <span className='w-40 shrink-0 truncate text-xs text-foreground' title={name}>
                {name}
              </span>
              <VariableAwareInput
                className='flex-1'
                value={valueOf(name)}
                onChange={next => setRows(upsertFormFieldRow(rows, name, next))}
                variableSources={sources}
                placeholder='Leave empty to skip'
              />
            </div>
          ))}

          {customRows.map((row, index) => (
            <div key={`custom-${index}`} className='flex items-center gap-2'>
              <input
                className='w-40 shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs'
                value={row.fieldName}
                placeholder='Field name'
                aria-label='Custom field name'
                data-track-category='Automation'
                data-track-name='CreateTicketCustomFormFieldName'
                onChange={e =>
                  setRows(rows.map(r => (r === row ? { ...r, fieldName: e.target.value } : r)))
                }
              />
              <VariableAwareInput
                className='flex-1'
                value={String(row.value ?? '')}
                onChange={next => setRows(rows.map(r => (r === row ? { ...r, value: next } : r)))}
                variableSources={sources}
                placeholder='Value'
              />
              <button
                type='button'
                aria-label={`Remove ${row.fieldName || 'field'}`}
                className='text-muted-foreground hover:text-foreground'
                data-track-category='Automation'
                data-track-name='CreateTicketRemoveCustomFormField'
                onClick={() => setRows(rows.filter(r => r !== row))}
              >
                <Trash2 className='size-3.5' />
              </button>
            </div>
          ))}

          <button
            type='button'
            className='flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
            onClick={() => setRows([...rows, { fieldName: '', value: '' }])}
            data-track-category='Automation'
            data-track-name='CreateTicketAddCustomFormField'
          >
            <Plus className='size-3.5' /> Add custom field
          </button>
        </div>
      )}
    </div>
  );
}
