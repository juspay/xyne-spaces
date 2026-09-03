import { ReactElement, useCallback, useState } from 'react';
import { Plus, X, Tag, Check, Pencil, Trash2 } from 'lucide-react';
import { Popover } from '../ui/Popover/Popover';
import { Button } from '../ui/Button';
import Input from '../ui/Input';
import { Dialog } from '../ui/Dialog';

export interface DashboardVariableDef {
  name: string;
  label: string;
  type: 'list';
  options: string[];
  multi?: boolean;
  defaultValue?: string | string[] | null;
}

export interface DashboardVariableState {
  current: string | string[] | null;
}

interface DashboardVariablesBarProps {
  definitions: DashboardVariableDef[];
  values: Record<string, DashboardVariableState>;
  canEdit: boolean;
  onDefinitionsChange: (next: DashboardVariableDef[]) => void;
  onValueChange: (name: string, next: DashboardVariableState) => void;
}

export const DashboardVariablesBar = ({
  definitions,
  values,
  canEdit,
  onDefinitionsChange,
  onValueChange,
}: DashboardVariablesBarProps): ReactElement | null => {
  const [editing, setEditing] = useState<DashboardVariableDef | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const deletingDef = deletingName
    ? (definitions.find(d => d.name === deletingName) ?? null)
    : null;

  const handleDelete = useCallback((name: string) => setDeletingName(name), []);

  const confirmDelete = useCallback(() => {
    if (!deletingName) return;
    onDefinitionsChange(definitions.filter(d => d.name !== deletingName));
    setDeletingName(null);
  }, [definitions, deletingName, onDefinitionsChange]);

  if (definitions.length === 0 && !canEdit) return null;

  return (
    <>
      <div className='flex items-center gap-2 flex-wrap px-6 py-2 border-b border-border bg-muted/30'>
        {definitions.map(d => (
          <VariableChip
            key={d.name}
            def={d}
            value={values[d.name]?.current ?? d.defaultValue ?? null}
            canEdit={canEdit}
            onValueChange={next => onValueChange(d.name, { current: next })}
            onEdit={() => setEditing(d)}
            onDelete={() => handleDelete(d.name)}
          />
        ))}
        {canEdit && (
          <button
            onClick={() => setCreating(true)}
            className='inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors'
            data-track-category='DYNAMIC_DASHBOARD'
            data-track-name='Add_Dashboard_Variable'
          >
            <Plus size={11} />
            Variable
          </button>
        )}
      </div>

      <Dialog
        open={creating || !!editing}
        onOpenChange={open => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        title={editing ? 'Edit variable' : 'New variable'}
        className='max-w-md'
      >
        <VariableEditor
          initial={editing ?? null}
          existingNames={definitions.map(d => d.name)}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={next => {
            const others = definitions.filter(d => d.name !== (editing?.name ?? next.name));
            onDefinitionsChange([...others, next]);
            setCreating(false);
            setEditing(null);
          }}
        />
      </Dialog>

      <Dialog
        open={!!deletingName}
        onOpenChange={open => !open && setDeletingName(null)}
        title='Delete variable'
      >
        <div className='p-6'>
          <p className='text-muted-foreground mb-6'>
            Delete variable
            {deletingDef ? ` "${deletingDef.label}"` : ''}? Charts that reference{' '}
            <code className='font-mono'>$&#123;{deletingName ?? ''}&#125;</code> will lose their
            filter.
          </p>
          <div className='flex justify-end gap-3'>
            <Button
              variant='secondary'
              onClick={() => setDeletingName(null)}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Cancel_Delete_Variable'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmDelete}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Confirm_Delete_Variable'
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};

interface VariableChipProps {
  def: DashboardVariableDef;
  value: string | string[] | null;
  canEdit: boolean;
  onValueChange: (next: string | string[] | null) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const VariableChip = ({
  def,
  value,
  canEdit,
  onValueChange,
  onEdit,
  onDelete,
}: VariableChipProps): ReactElement => {
  const selected = new Set<string>(Array.isArray(value) ? value : value ? [value] : []);
  const displayValue =
    selected.size === 0
      ? 'All'
      : selected.size === 1
        ? Array.from(selected)[0]!
        : `${selected.size} selected`;

  const toggle = (v: string): void => {
    if (def.multi) {
      const next = new Set(selected);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      const arr = Array.from(next);
      onValueChange(arr.length === 0 ? null : arr);
    } else {
      onValueChange(selected.has(v) ? null : v);
    }
  };
  const clearAll = (): void => onValueChange(null);

  return (
    <Popover
      side='bottom'
      align='start'
      sideOffset={4}
      trigger={
        <button
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors ${
            selected.size > 0
              ? 'bg-accent border-border text-foreground'
              : 'bg-background border-border text-muted-foreground hover:bg-accent'
          }`}
        >
          <Tag size={11} />
          <span className='font-medium'>{def.label}:</span>
          <span>{displayValue}</span>
        </button>
      }
    >
      <div className='w-60 p-1.5'>
        <div className='flex items-center justify-between px-2 pt-1 pb-1.5'>
          <span className='text-[10px] uppercase tracking-wider font-semibold text-muted-foreground'>
            {def.label}
          </span>
          <div className='flex items-center gap-0.5'>
            {selected.size > 0 && (
              <button
                onClick={clearAll}
                className='text-[10px] text-muted-foreground hover:text-foreground px-1'
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Clear_Variable_Selection'
              >
                Clear
              </button>
            )}
            {canEdit && (
              <>
                <IconAction onClick={onEdit} aria-label='Edit variable'>
                  <Pencil size={10} />
                </IconAction>
                <IconAction onClick={onDelete} aria-label='Delete variable'>
                  <Trash2 size={10} />
                </IconAction>
              </>
            )}
          </div>
        </div>
        <div className='max-h-56 overflow-auto'>
          {def.options.length === 0 && (
            <div className='px-2 py-2 text-xs text-muted-foreground italic'>
              No options configured.
            </div>
          )}
          {def.options.map(opt => {
            const isSel = selected.has(opt);
            return (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={`flex items-center justify-between w-full px-2 py-1.5 rounded text-sm transition-colors ${
                  isSel ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/60'
                }`}
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Toggle_Variable_Option'
              >
                <span className='truncate'>{opt}</span>
                {isSel && <Check size={12} />}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
};

const IconAction = ({
  onClick,
  children,
  ...rest
}: {
  onClick: () => void;
  children: React.ReactNode;
  'aria-label': string;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    className='p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground'
    data-track-category='DYNAMIC_DASHBOARD'
    data-track-name='Variable_Icon_Action'
    {...rest}
  >
    {children}
  </button>
);

interface VariableEditorProps {
  initial: DashboardVariableDef | null;
  existingNames: string[];
  onCancel: () => void;
  onSave: (next: DashboardVariableDef) => void;
}

const VariableEditor = ({
  initial,
  existingNames,
  onCancel,
  onSave,
}: VariableEditorProps): ReactElement => {
  const [name, setName] = useState(initial?.name ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [optionsText, setOptionsText] = useState(initial?.options.join(', ') ?? '');
  const [multi, setMulti] = useState(initial?.multi ?? false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = (): void => {
    const trimmedName = name.trim();
    const trimmedLabel = label.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
      setError('Name must be letters / numbers / underscore, starting with a letter or _.');
      return;
    }
    if (!trimmedLabel) {
      setError('Label is required.');
      return;
    }
    if (!initial && existingNames.includes(trimmedName)) {
      setError(`A variable named "${trimmedName}" already exists.`);
      return;
    }
    const opts = optionsText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (opts.length === 0) {
      setError('Add at least one option.');
      return;
    }
    onSave({
      name: trimmedName,
      label: trimmedLabel,
      type: 'list',
      options: opts,
      multi,
    });
  };

  return (
    <div className='p-4 space-y-3'>
      <div className='space-y-1'>
        <label
          htmlFor='var-name'
          className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
        >
          Name (used as <code className='font-mono'>${'{name}'}</code>)
        </label>
        <Input
          id='var-name'
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder='e.g. status'
          disabled={!!initial}
        />
      </div>
      <div className='space-y-1'>
        <label
          htmlFor='var-label'
          className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
        >
          Label
        </label>
        <Input
          id='var-label'
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder='e.g. Status'
        />
      </div>
      <div className='space-y-1'>
        <label
          htmlFor='var-options'
          className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
        >
          Options (comma-separated)
        </label>
        <Input
          id='var-options'
          value={optionsText}
          onChange={e => setOptionsText(e.target.value)}
          placeholder='open, closed, pending'
        />
      </div>
      <label className='flex items-center gap-2 text-sm text-foreground'>
        <input
          type='checkbox'
          checked={multi}
          onChange={e => setMulti(e.target.checked)}
          className='h-3.5 w-3.5'
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Toggle_Variable_Multi'
        />
        Allow multiple selection
      </label>
      {error && (
        <div className='flex items-start gap-1.5 text-xs text-rose-600'>
          <X size={12} className='mt-0.5 shrink-0' />
          {error}
        </div>
      )}
      <p className='text-[11px] text-muted-foreground'>
        Reference this variable inside any filter value as{' '}
        <code className='font-mono'>$&#123;{name || 'name'}&#125;</code>. Multi-select variables
        auto-upgrade <code>equals</code> filters to <code>in</code>.
      </p>
      <div className='flex justify-end gap-2 pt-1'>
        <Button
          variant='ghost'
          onClick={onCancel}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='CANCEL_DASHBOARD_VARIABLES'
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='SAVE_DASHBOARD_VARIABLES'
        >
          {initial ? 'Save changes' : 'Create variable'}
        </Button>
      </div>
    </div>
  );
};
