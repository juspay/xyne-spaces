import { useMemo } from 'react';
import { Clock, Zap } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import Input from '../../../ui/Input/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import {
  MAX_SCHEDULE_OFFSET_MINUTES,
  type JsonSchema,
  type ScheduleConfig,
  type ScheduleOffsetUnit,
  type TriggerSchema,
} from '../../Automation.types';

interface ScheduleCardProps {
  schedule: ScheduleConfig | undefined;
  triggerSchema: TriggerSchema | null;
  onChange: (next: ScheduleConfig | undefined) => void;
}

interface DateFieldOption {
  path: string;
  label: string;
}

function resolveRef(
  schema: JsonSchema,
  definitions: Record<string, JsonSchema> | undefined,
): JsonSchema {
  if (!schema.$ref || !definitions) return schema;
  const match = /^#\/definitions\/(.+)$/.exec(schema.$ref);
  if (!match) return schema;
  const target = definitions[match[1] ?? ''];
  return target ? { ...target, definitions } : schema;
}

function isDateLeaf(schema: JsonSchema, definitions?: Record<string, JsonSchema>): boolean {
  const resolved = resolveRef(schema, definitions);
  if (resolved.type === 'string' && resolved.format === 'date-time') return true;
  if (resolved.format === 'date-time') return true;
  const branches = resolved.anyOf ?? resolved.oneOf;
  if (branches) return branches.some(b => isDateLeaf(b, definitions));
  return false;
}

function findDateFields(
  schema: JsonSchema | undefined,
  prefix = '',
  rootDefinitions?: Record<string, JsonSchema>,
): DateFieldOption[] {
  if (!schema || typeof schema !== 'object') return [];
  const definitions = rootDefinitions ?? schema.definitions;
  const resolved = resolveRef(schema, definitions);
  const out: DateFieldOption[] = [];
  const properties =
    resolved.properties ??
    (resolved.anyOf ?? resolved.oneOf ?? []).reduce<JsonSchema['properties']>(
      (acc, branch) => ({ ...(acc ?? {}), ...(resolveRef(branch, definitions).properties ?? {}) }),
      undefined,
    );
  if (!properties) return out;
  for (const [key, child] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!child || typeof child !== 'object') continue;
    if (isDateLeaf(child, definitions)) {
      out.push({ path, label: path });
      continue;
    }
    out.push(...findDateFields(child, path, definitions));
  }
  return out;
}

const MAX_BY_UNIT: Record<ScheduleOffsetUnit, number> = {
  minutes: MAX_SCHEDULE_OFFSET_MINUTES,
  hours: Math.floor(MAX_SCHEDULE_OFFSET_MINUTES / 60),
  days: Math.floor(MAX_SCHEDULE_OFFSET_MINUTES / 60 / 24),
};

export function ScheduleCard({
  schedule,
  triggerSchema,
  onChange,
}: ScheduleCardProps): React.ReactElement {
  const mode: 'IMMEDIATE' | 'SCHEDULED' =
    schedule?.type === 'SCHEDULED' ? 'SCHEDULED' : 'IMMEDIATE';

  const dateFields = useMemo(
    () => findDateFields(triggerSchema?.outputSchema),
    [triggerSchema?.outputSchema],
  );

  const handleModeChange = (next: 'IMMEDIATE' | 'SCHEDULED'): void => {
    if (next === 'IMMEDIATE') {
      onChange(undefined);
      return;
    }
    const defaultField = dateFields[0]?.path ?? '';
    onChange({
      type: 'SCHEDULED',
      field: defaultField,
      offset: { amount: 1, unit: 'hours' },
    });
  };

  const sched = schedule?.type === 'SCHEDULED' ? schedule : null;
  const maxForUnit = sched ? MAX_BY_UNIT[sched.offset.unit] : MAX_BY_UNIT.minutes;
  const overMax = sched ? sched.offset.amount > maxForUnit : false;
  const amountInvalid = sched ? sched.offset.amount <= 0 || overMax : false;
  const fieldInvalid = sched ? sched.field.length === 0 : false;

  return (
    <div className='flex flex-col gap-4 rounded-md border border-border bg-background p-5'>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center gap-2'>
          <span className='flex size-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400'>
            <Clock className='size-4' />
          </span>
          <span className='text-sm font-semibold text-foreground'>Run timing</span>
        </div>
        <p className='ml-9 text-xs text-muted-foreground'>
          Run now, or wait a fixed time after one of the trigger&apos;s date fields. The trigger
          payload is re-read from the database right before the actions run.
        </p>
      </div>

      <div className='ml-9 flex flex-col gap-3'>
        <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
          <ModeTile
            active={mode === 'IMMEDIATE'}
            icon={<Zap className='size-4' />}
            label='Run immediately'
            description='Fire the actions as soon as the trigger matches.'
            onClick={() => handleModeChange('IMMEDIATE')}
          />
          <ModeTile
            active={mode === 'SCHEDULED'}
            icon={<Clock className='size-4' />}
            label='Wait, then run'
            description='Defer up to 30 days from a date field on the trigger.'
            onClick={() => handleModeChange('SCHEDULED')}
          />
        </div>

        {sched && (
          <div className='flex flex-col gap-3 rounded-md border border-border/80 bg-muted/30 p-3'>
            <div className='flex flex-wrap items-end gap-2'>
              <FieldGroup label='Wait for' invalid={amountInvalid}>
                <Input
                  type='number'
                  min={1}
                  max={maxForUnit}
                  value={sched.offset.amount}
                  onChange={e =>
                    onChange({
                      ...sched,
                      offset: { ...sched.offset, amount: Number(e.target.value) || 0 },
                    })
                  }
                  className='h-9 w-24'
                />
              </FieldGroup>

              <FieldGroup label='Unit'>
                <Select
                  value={sched.offset.unit}
                  onValueChange={(v: ScheduleOffsetUnit) =>
                    onChange({
                      ...sched,
                      offset: { ...sched.offset, unit: v },
                    })
                  }
                >
                  <SelectTrigger className='h-9 w-32'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='minutes'>Minutes</SelectItem>
                    <SelectItem value='hours'>Hours</SelectItem>
                    <SelectItem value='days'>Days</SelectItem>
                  </SelectContent>
                </Select>
              </FieldGroup>

              <span className='pb-2 text-xs text-muted-foreground'>after</span>

              <FieldGroup label='Anchor date field' invalid={fieldInvalid}>
                <Select
                  {...(sched.field ? { value: sched.field } : {})}
                  onValueChange={v => onChange({ ...sched, field: v })}
                >
                  <SelectTrigger className='h-9 w-72'>
                    <SelectValue placeholder='Pick a date field…' />
                  </SelectTrigger>
                  <SelectContent>
                    {dateFields.map(f => (
                      <SelectItem key={f.path} value={f.path}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>
            </div>

            {overMax && (
              <p className='text-[11px] text-destructive'>
                Cannot wait longer than 30 days ({maxForUnit} {sched.offset.unit}).
              </p>
            )}
            {fieldInvalid && (
              <p className='text-[11px] text-destructive'>Pick a date field to anchor on.</p>
            )}
            {dateFields.length === 0 && (
              <p className='text-[11px] text-destructive'>
                This trigger doesn&apos;t expose a date field — switch back to &quot;Run
                immediately&quot;.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeTile({
  active,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      data-track-category='automation-builder'
      data-track-name={`schedule-mode-${active ? 'active' : 'inactive'}`}
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
        active
          ? 'border-foreground/40 bg-accent/50'
          : 'border-border bg-background hover:bg-accent/30',
      )}
    >
      <div className='flex items-center gap-2'>
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-md',
            active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
          )}
        >
          {icon}
        </span>
        <span className='text-sm font-medium text-foreground'>{label}</span>
      </div>
      <p className='ml-8 text-[11px] text-muted-foreground'>{description}</p>
    </button>
  );
}

function FieldGroup({
  label,
  invalid,
  children,
}: {
  label: string;
  invalid?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className='flex flex-col gap-1'>
      <span
        className={cn(
          'text-[10px] font-medium uppercase tracking-[0.08em]',
          invalid ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
