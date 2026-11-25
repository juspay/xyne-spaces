import { useMemo } from 'react';
import { Plus, TextCursorInput, Trash2 } from 'lucide-react';
import {
  BoardType,
  FormContextType,
  FormFieldType,
  type FormFields,
  type GlobalField,
} from '@xyne/shared';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import {
  resolveDisplayFormFields,
  type ResolvedDisplayFormField,
} from '../../../../utils/board/resolveDisplayFormFields';
import { Button } from '../../../ui/Button/Button';
import { EntitySelector } from '../../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../../ui/EntitySelector/EntitySelector.types';
import type { ValidationIssue } from '../../Automation.types';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';
import type { SchemaFormProps } from '../SchemaForm/SchemaForm.types';
import { VariableAwareInput } from '../SchemaForm/VariableAwareInput';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

const FORM_VALUES_KEY = 'formValues';

type MembershipRow = FormFields & { globalField?: GlobalField | null };

interface FormValueRow {
  fieldName: string;
  value?: unknown;
}

interface StageMoveForm {
  key: string;
  label: string;
  fields: ResolvedDisplayFormField[];
}

interface FieldSuggestion {
  fieldName: string;
  fieldType: FormFieldType;
  required: boolean;
  options: string[];
  forms: string[];
}

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  [FormFieldType.STRING]: 'Text',
  [FormFieldType.NUMBER]: 'Number',
  [FormFieldType.BOOLEAN]: 'Yes / no',
  [FormFieldType.DATE]: 'Date',
  [FormFieldType.SINGLE_SELECT]: 'Single select',
  [FormFieldType.MULTI_SELECT]: 'Multi select',
  [FormFieldType.USER]: 'User',
  [FormFieldType.DOC]: 'File',
  [FormFieldType.TICKET]: 'Ticket',
};

/** CHANGE_STAGE: the generic ticket/stage fields plus the form values for the move. */
export function ChangeStageStepForm(props: SchemaFormProps): React.ReactElement {
  const root = resolveSchema(props.schema);
  const properties = Object.fromEntries(
    Object.entries(root.properties ?? {}).filter(([key]) => key !== FORM_VALUES_KEY),
  );
  const rawStage = props.value['stageName'];
  const stageIsVariable = typeof rawStage === 'string' && rawStage.includes('{{');
  const stageName = typeof rawStage === 'string' && !stageIsVariable ? rawStage.trim() : '';
  const rows = toRows(props.value[FORM_VALUES_KEY]);

  const setRows = (next: FormValueRow[]): void => {
    const { [FORM_VALUES_KEY]: _previous, ...rest } = props.value;
    props.onChange(next.length > 0 ? { ...rest, [FORM_VALUES_KEY]: next } : rest);
  };

  return (
    <div className='flex flex-col gap-4'>
      <SchemaForm {...props} schema={{ ...root, properties }} />
      {FORM_VALUES_KEY in (root.properties ?? {}) && (
        <StageFormValuesField
          stageName={stageName}
          stageIsVariable={stageIsVariable}
          rows={rows}
          onChange={setRows}
          issues={issuesByRelativePath(props.issues, props.pathPrefix)}
          variableSources={props.variableSources ?? []}
        />
      )}
    </div>
  );
}

interface StageFormValuesFieldProps {
  stageName: string;
  stageIsVariable: boolean;
  rows: FormValueRow[];
  onChange: (next: FormValueRow[]) => void;
  issues: Map<string, string>;
  variableSources: VariablePickerSource[];
}

function StageFormValuesField({
  stageName,
  stageIsVariable,
  rows,
  onChange,
  issues,
  variableSources,
}: StageFormValuesFieldProps): React.ReactElement {
  const forms = useStageMoveForms(stageName);
  const suggestions = useMemo(() => mergeFormFields(forms), [forms]);
  const suggestionByName = useMemo(
    () => new Map(suggestions.map(s => [normalizeName(s.fieldName), s])),
    [suggestions],
  );
  const usedNames = new Set(rows.map(row => normalizeName(row.fieldName)));
  const missingRequired = suggestions.filter(
    s => s.required && !usedNames.has(normalizeName(s.fieldName)),
  );

  const updateRow = (index: number, patch: Partial<FormValueRow>): void => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const description = stageIsVariable
    ? 'The stage is a variable, so type field names exactly as they appear on the form.'
    : !stageName
      ? 'Pick a stage to see the fields of the form the move needs.'
      : forms.length === 0
        ? `No form is set up for moves into "${stageName}". Values are only used when the move needs a form.`
        : `Fills the form for moves into "${stageName}" (${forms.map(f => f.label).join(' · ')}). Required fields need a value or the step fails; fields not on the ticket's form are skipped.`;

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/40 px-3 py-3'>
      <div className='flex flex-col gap-0.5'>
        <span className='text-xs font-medium text-foreground'>Form values</span>
        <span className='text-[11px] text-muted-foreground'>{description}</span>
      </div>

      {rows.length === 0 ? (
        <div className='text-[11px] italic text-muted-foreground'>
          No form values. The ticket moves without filling a form.
        </div>
      ) : (
        <div className='flex flex-col gap-2'>
          {rows.map((row, index) => {
            const suggestion = suggestionByName.get(normalizeName(row.fieldName));
            const nameError = issues.get(`${FORM_VALUES_KEY}.${index}.fieldName`);
            const valueError =
              issues.get(`${FORM_VALUES_KEY}.${index}.value`) ??
              issues.get(`${FORM_VALUES_KEY}.${index}`);
            const hint = valueHint(suggestion);
            return (
              <div key={index} className='flex items-start gap-2'>
                <div className='flex w-2/5 shrink-0 flex-col gap-1'>
                  {suggestions.length > 0 ? (
                    <EntitySelector
                      options={fieldOptions(suggestions, row.fieldName, suggestion)}
                      selectedValue={suggestion?.fieldName ?? (row.fieldName || null)}
                      onSelect={next => updateRow(index, { fieldName: next ?? '' })}
                      placeholder='Pick a field'
                      searchPlaceholder='Search fields…'
                      width='100%'
                      inputClassName='min-h-9'
                      allowDeselect={false}
                      analytics={{
                        category: 'automation-builder',
                        optionName: 'change-stage-form-field-option',
                      }}
                    />
                  ) : (
                    <input
                      type='text'
                      value={row.fieldName}
                      onChange={e => updateRow(index, { fieldName: e.target.value })}
                      placeholder='Field name'
                      aria-label='Form field name'
                      aria-invalid={nameError ? true : undefined}
                      data-track-category='automation-builder'
                      data-track-name='change-stage-form-field-name'
                      className='h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40'
                    />
                  )}
                  {nameError && <FieldError message={nameError} />}
                </div>
                <div className='flex min-w-0 flex-1 flex-col gap-1'>
                  <VariableAwareInput
                    value={displayValue(row.value)}
                    onChange={next => updateRow(index, { value: next })}
                    variableSources={variableSources}
                    placeholder='Value or {{variable}}'
                    ariaInvalid={!!valueError}
                  />
                  {hint && <span className='text-[11px] text-muted-foreground'>{hint}</span>}
                  {valueError && <FieldError message={valueError} />}
                </div>
                <button
                  type='button'
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  aria-label='Remove form value'
                  data-track-category='automation-builder'
                  data-track-name='change-stage-form-value-remove'
                  className='mt-0.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-600'
                >
                  <Trash2 className='size-4' />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {missingRequired.length > 0 && (
        <span className='text-[11px] text-amber-700 dark:text-amber-400'>
          Required on this form: {missingRequired.map(s => s.fieldName).join(', ')}
        </span>
      )}
      {issues.get(FORM_VALUES_KEY) && <FieldError message={issues.get(FORM_VALUES_KEY)} />}

      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onChange([...rows, { fieldName: '', value: '' }])}
          data-track-category='automation-builder'
          data-track-name='change-stage-form-value-add'
        >
          <Plus className='size-4' />
          Add form value
        </Button>
        {missingRequired.length > 0 && (
          <Button
            variant='outline'
            size='sm'
            onClick={() =>
              onChange([
                ...rows,
                ...missingRequired.map(s => ({ fieldName: s.fieldName, value: '' })),
              ])
            }
            data-track-category='automation-builder'
            data-track-name='change-stage-form-value-add-required'
          >
            Add required fields
          </Button>
        )}
      </div>
    </div>
  );
}

/** Forms a move into `stageName` can need: transition forms (non-linear) or stage forms (linear). */
function useStageMoveForms(stageName: string): StageMoveForm[] {
  const [boards] = useCachedQuery(queries.getAllBoardsList());
  const boardIds = useMemo(() => (boards ?? []).map(b => b.id), [boards]);
  const [stages] = useCachedQuery(queries.getStagesByBoardIds({ boardIds }), {
    enabled: boardIds.length > 0,
  });
  const boardById = useMemo(() => new Map((boards ?? []).map(b => [b.id, b])), [boards]);
  const targets = useMemo(
    () => (stageName ? (stages ?? []).filter(s => s.name === stageName) : []),
    [stages, stageName],
  );
  const nonLinearBoardIds = useMemo(
    () => [
      ...new Set(
        targets
          .filter(s => boardById.get(s.boardId)?.boardType === BoardType.NON_LINEAR)
          .map(s => s.boardId),
      ),
    ],
    [targets, boardById],
  );
  const hasLinearTarget = targets.some(s => isLinearBoard(boardById.get(s.boardId)?.boardType));

  const [transitions] = useCachedQuery(
    queries.getStageTransitionsByBoardIds({ boardIds: nonLinearBoardIds }),
    { enabled: nonLinearBoardIds.length > 0 },
  );
  const [stageForms] = useCachedQuery(
    queries.getFormsByContextType({ contextType: FormContextType.STAGE }),
    { enabled: hasLinearTarget },
  );

  return useMemo(() => {
    const stageNameById = new Map((stages ?? []).map(s => [s.id, s.name]));
    const forms: StageMoveForm[] = [];
    for (const target of targets) {
      const board = boardById.get(target.boardId);
      if (!board) continue;
      if (board.boardType === BoardType.NON_LINEAR) {
        for (const transition of transitions ?? []) {
          // Global (from-any) edges never gate a move, so their forms don't apply here.
          if (
            !transition.fromStageId ||
            transition.toStageId !== target.id ||
            !transition.formId ||
            !transition.form
          ) {
            continue;
          }
          forms.push({
            key: transition.id,
            label: `${board.name}: ${stageNameById.get(transition.fromStageId) ?? '?'} → ${target.name}`,
            fields: resolveDisplayFormFields(
              transition.formId,
              (transition.form.formFields ?? []) as MembershipRow[],
            ),
          });
        }
      } else if (isLinearBoard(board.boardType)) {
        for (const form of stageForms ?? []) {
          const isMapped = (form.formContextMappings ?? []).some(
            m => m.contextId === target.id && m.contextType === FormContextType.STAGE,
          );
          if (!isMapped) continue;
          forms.push({
            key: `${form.id}:${target.id}`,
            label: `${board.name}: ${target.name} form`,
            fields: resolveDisplayFormFields(form.id, (form.formFields ?? []) as MembershipRow[]),
          });
        }
      }
    }
    return forms;
  }, [targets, boardById, stages, transitions, stageForms]);
}

function mergeFormFields(forms: StageMoveForm[]): FieldSuggestion[] {
  const byName = new Map<string, FieldSuggestion>();
  for (const form of forms) {
    for (const field of form.fields) {
      // Branch fields are only required when their parent option is picked.
      const required = !field.isOptional && !field.parentOptionId;
      const existing = byName.get(normalizeName(field.fieldName));
      if (existing) {
        existing.required = existing.required || required;
        if (!existing.forms.includes(form.label)) existing.forms.push(form.label);
        continue;
      }
      byName.set(normalizeName(field.fieldName), {
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        required,
        options: (field.fieldEnum ?? []).map(option => option.value),
        forms: [form.label],
      });
    }
  }
  return [...byName.values()];
}

function fieldOptions(
  suggestions: FieldSuggestion[],
  current: string,
  matched: FieldSuggestion | undefined,
): SelectorOption[] {
  const icon = <TextCursorInput className='size-4 text-muted-foreground' />;
  const options: SelectorOption[] = suggestions.map(s => ({
    value: s.fieldName,
    label: s.fieldName,
    icon,
    subtitle: `${FIELD_TYPE_LABELS[s.fieldType]} · ${s.forms.length > 1 ? `${s.forms.length} forms` : (s.forms[0] ?? '')}`,
    badge: s.required ? 'Required' : undefined,
  }));
  if (current.trim() && !matched) {
    options.unshift({ value: current, label: current, icon, subtitle: 'Not on these forms' });
  }
  return options;
}

function valueHint(suggestion: FieldSuggestion | undefined): string | undefined {
  if (!suggestion) return undefined;
  const options =
    suggestion.options.length > 8
      ? `${suggestion.options.slice(0, 8).join(', ')}, …`
      : suggestion.options.join(', ');
  switch (suggestion.fieldType) {
    case FormFieldType.SINGLE_SELECT:
      return options ? `One of: ${options}` : undefined;
    case FormFieldType.MULTI_SELECT:
      return `${options ? `Any of: ${options}. ` : ''}Use a list variable for several.`;
    case FormFieldType.USER:
      return 'A user ID, or a variable holding user IDs.';
    case FormFieldType.DATE:
      return 'A date, e.g. 2026-01-31.';
    case FormFieldType.BOOLEAN:
      return 'true or false.';
    case FormFieldType.NUMBER:
      return 'A number.';
    case FormFieldType.TICKET:
      return 'A ticket ID, e.g. ABC-123.';
    case FormFieldType.DOC:
      return "File fields can't be filled by an automation.";
    default:
      return undefined;
  }
}

function FieldError({ message }: { message?: string | undefined }): React.ReactElement | null {
  if (!message) return null;
  return <span className='text-[11px] text-red-600 dark:text-red-400'>{message}</span>;
}

function toRows(raw: unknown): FormValueRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const fieldName = typeof record['fieldName'] === 'string' ? record['fieldName'] : '';
    return 'value' in record ? { fieldName, value: record['value'] } : { fieldName };
  });
}

// Values set through the API can be lists or numbers; they stay as-is until edited here.
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  return JSON.stringify(value);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isLinearBoard(boardType: string | null | undefined): boolean {
  return boardType === BoardType.DEFAULT || boardType === BoardType.RELEASE;
}

/** Issues under this step's config, keyed by relative path with array indexes dotted. */
function issuesByRelativePath(
  issues: ValidationIssue[] | null | undefined,
  pathPrefix: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const issue of issues ?? []) {
    if (!issue.path.startsWith(pathPrefix)) continue;
    const relative = issue.path
      .slice(pathPrefix.length)
      .replace(/\[(\d+)\]/g, '.$1')
      .replace(/^\./, '');
    if (!map.has(relative)) map.set(relative, issue.message);
  }
  return map;
}
