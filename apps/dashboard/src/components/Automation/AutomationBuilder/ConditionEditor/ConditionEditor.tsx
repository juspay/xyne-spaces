import { useMemo, useState } from 'react';
import { Plus, Trash2, Variable, X } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Button } from '../../../ui/Button/Button';
import Input from '../../../ui/Input/Input';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { Popover } from '../../../ui/Popover/Popover';
import type { Condition, LeafCondition } from '../../Automation.types';
import { VariablePicker } from '../VariablePicker/VariablePicker';
import { formatReferenceLabel } from '../VariablePicker/VariablePicker.utils';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import { EntityField } from '../SchemaForm/EntityField';
import { detectEntityKind, isVariableRefValue } from '../SchemaForm/SchemaForm.utils';
import { ReferenceChip, UseVariableButton } from '../SchemaForm/VariableFieldParts';
import type { ConditionEditorProps } from './ConditionEditor.types';
import { isAndGroup, isLeaf, makeEmptyLeaf, resolveLeafSchema } from './ConditionEditor.utils';
import { TagValueInput } from './TagValueInput';

const MAX_DEPTH = 2;

export function ConditionEditor({
  value,
  onChange,
  operators,
  variableSources,
  depth = 0,
}: ConditionEditorProps): React.ReactElement {
  if (isLeaf(value)) {
    return (
      <LeafRow
        leaf={value}
        operators={operators}
        variableSources={variableSources}
        onChange={onChange}
        canWrap={depth < MAX_DEPTH}
      />
    );
  }

  const groupKey = isAndGroup(value) ? 'all' : 'any';
  const groupLabel = groupKey === 'all' ? 'ALL of these are true' : 'ANY of these is true';
  const items = (value as { all?: Condition[]; any?: Condition[] })[groupKey] ?? [];

  const updateItem = (index: number, next: Condition): void => {
    const copy = items.slice();
    copy[index] = next;
    onChange({ [groupKey]: copy } as Condition);
  };

  const removeItem = (index: number): void => {
    const copy = items.filter((_, i) => i !== index);
    if (copy.length === 0) {
      onChange(makeEmptyLeaf());
      return;
    }
    onChange({ [groupKey]: copy } as Condition);
  };

  const addLeaf = (): void => {
    onChange({ [groupKey]: [...items, makeEmptyLeaf()] } as Condition);
  };

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3'>
      <div className='flex items-center gap-2'>
        <span className='rounded-md border border-border bg-accent/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground'>
          {groupKey === 'all' ? 'AND' : 'OR'}
        </span>
        <span className='text-xs text-muted-foreground'>{groupLabel}</span>
      </div>
      <div className='flex flex-col gap-2'>
        {items.map((item, index) => (
          <div key={index} className='flex items-start gap-2'>
            <div className='flex-1'>
              <ConditionEditor
                value={item}
                onChange={next => updateItem(index, next)}
                operators={operators}
                variableSources={variableSources}
                depth={depth + 1}
              />
            </div>
            <button
              type='button'
              onClick={() => removeItem(index)}
              data-track-category='automation-builder'
              data-track-name='condition-remove'
              className='mt-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-500/10'
              aria-label='Remove condition'
            >
              <Trash2 className='size-4' />
            </button>
          </div>
        ))}
      </div>
      <div className='flex gap-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={addLeaf}
          data-track-category='automation-builder'
          data-track-name='ADD_CONDITION_LEAF'
        >
          <Plus className='size-4' />
          Add condition
        </Button>
      </div>
    </div>
  );
}

interface LeafRowProps {
  leaf: LeafCondition;
  operators: {
    value: string;
    label: string;
    valueType: 'string' | 'number' | 'boolean' | 'none' | 'tag';
  }[];
  variableSources: VariablePickerSource[];
  onChange: (next: Condition) => void;
  canWrap: boolean;
}

function LeafRow({
  leaf,
  operators,
  variableSources,
  onChange,
  canWrap,
}: LeafRowProps): React.ReactElement {
  const operator = operators.find(o => o.value === leaf.operator);
  const showValue = operator && operator.valueType !== 'none';

  const leafSchema = useMemo(
    () => (leaf.variable ? resolveLeafSchema(leaf.variable, variableSources) : null),
    [leaf.variable, variableSources],
  );
  const enumValues =
    leafSchema?.schema.enum && Array.isArray(leafSchema.schema.enum)
      ? leafSchema.schema.enum.map(v => String(v))
      : null;
  const entityKind = leafSchema ? detectEntityKind(leafSchema.lastKey) : null;

  const update = (patch: Partial<LeafCondition>): void => {
    onChange({ ...leaf, ...patch });
  };

  const wrap = (kind: 'all' | 'any'): void => {
    onChange({ [kind]: [leaf, makeEmptyLeaf()] } as Condition);
  };

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-3'>
      <div className='flex flex-wrap items-start gap-2'>
        <div className='flex-1 min-w-[200px]'>
          <VariableField
            value={leaf.variable}
            sources={variableSources}
            onChange={next => update({ variable: next })}
          />
        </div>
        <div className='w-[200px]'>
          <Select value={leaf.operator} onValueChange={v => update({ operator: v })}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Operator' />
            </SelectTrigger>
            <SelectContent>
              {operators.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showValue && (
          <div className='flex-1 min-w-[160px]'>
            <ValueOperand
              operator={operator}
              value={leaf.value}
              onChange={next => update({ value: next })}
              enumValues={enumValues}
              entityKind={entityKind}
              variableSources={variableSources}
            />
          </div>
        )}
      </div>
      {canWrap && (
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => wrap('all')}
            data-track-category='automation-builder'
            data-track-name='condition-wrap-and'
            className='text-[11px] text-muted-foreground hover:text-foreground'
          >
            + Group AND
          </button>
          <button
            type='button'
            onClick={() => wrap('any')}
            data-track-category='automation-builder'
            data-track-name='condition-wrap-or'
            className='text-[11px] text-muted-foreground hover:text-foreground'
          >
            + Group OR
          </button>
        </div>
      )}
    </div>
  );
}

function ValueOperand({
  operator,
  value,
  onChange,
  enumValues,
  entityKind,
  variableSources,
}: {
  operator: { valueType: 'string' | 'number' | 'boolean' | 'none' | 'tag' } | undefined;
  value: unknown;
  onChange: (next: unknown) => void;
  enumValues: string[] | null;
  entityKind: ReturnType<typeof detectEntityKind>;
  variableSources: VariablePickerSource[];
}): React.ReactElement {
  // The right-hand operand can be a literal constant or a variable reference
  // (variable-to-variable comparison). When it holds a ref show the shared
  // ReferenceChip; otherwise show the literal input plus the shared "use
  // variable" picker — the same pattern as SchemaForm's VariableRefField.
  if (isVariableRefValue(value)) {
    return (
      <ReferenceChip value={value} sources={variableSources} onClear={() => onChange(undefined)} />
    );
  }

  return (
    <div className='flex items-start gap-2'>
      <div className='min-w-0 flex-1'>
        <ValueInput
          operator={operator}
          value={value}
          onChange={onChange}
          enumValues={enumValues}
          entityKind={entityKind}
        />
      </div>
      {operator?.valueType !== 'tag' && (
        <UseVariableButton sources={variableSources} onPick={onChange} modal={true} />
      )}
    </div>
  );
}

function ValueInput({
  operator,
  value,
  onChange,
  enumValues,
  entityKind,
}: {
  operator: { valueType: 'string' | 'number' | 'boolean' | 'none' | 'tag' } | undefined;
  value: unknown;
  onChange: (next: unknown) => void;
  enumValues: string[] | null;
  entityKind: ReturnType<typeof detectEntityKind>;
}): React.ReactElement {
  if (operator?.valueType === 'tag') {
    return <TagValueInput value={typeof value === 'string' ? value : ''} onChange={onChange} />;
  }
  if (operator?.valueType === 'boolean') {
    return (
      <Checkbox
        checked={value === true}
        onChange={checked => onChange(checked === true)}
        label='True'
      />
    );
  }
  if (operator?.valueType === 'number') {
    return (
      <Input
        type='number'
        placeholder='Value'
        value={typeof value === 'number' ? String(value) : ''}
        onChange={e => {
          const n = Number(e.target.value);
          onChange(Number.isNaN(n) ? undefined : n);
        }}
      />
    );
  }
  if (enumValues && enumValues.length > 0) {
    const selected = typeof value === 'string' ? value : '';
    return (
      <Select value={selected} onValueChange={v => onChange(v)}>
        <SelectTrigger className='w-full'>
          <SelectValue placeholder='Select…' />
        </SelectTrigger>
        <SelectContent>
          {enumValues.map(v => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (entityKind) {
    return (
      <EntityField
        kind={entityKind}
        value={typeof value === 'string' ? value : undefined}
        onChange={next => onChange(next)}
      />
    );
  }
  return (
    <Input
      placeholder='Value'
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value)}
    />
  );
}

interface VariableFieldProps {
  value: string;
  sources: VariablePickerSource[];
  onChange: (next: string) => void;
}

function VariableField({ value, sources, onChange }: VariableFieldProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const isRef = value.length > 0;
  const label = isRef ? formatReferenceLabel(value, sources) : 'Pick a variable…';

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align='start'
      side='bottom'
      sideOffset={4}
      modal={true}
      className='rounded-xl p-0 overflow-hidden'
      trigger={
        <button
          type='button'
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-left text-sm',
            isRef ? 'text-foreground' : 'text-muted-foreground',
            'hover:bg-accent/40',
          )}
        >
          <span className='flex items-center gap-2 truncate'>
            <Variable className='size-3.5 text-muted-foreground' />
            <span className='truncate'>{label}</span>
          </span>
          {isRef && (
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                onChange('');
              }}
              data-track-category='automation-builder'
              data-track-name='condition-clear-variable'
              aria-label='Clear variable'
              className='flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent/60'
            >
              <X className='size-3' />
            </button>
          )}
        </button>
      }
    >
      <VariablePicker
        sources={sources}
        onSelect={entry => onChange(entry.reference)}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
}
