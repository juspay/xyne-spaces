import { type ReactElement, type ReactNode } from 'react';
import { PencilEditLine } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import {
  DIGITAL_TWIN_EASE_OUT,
  DIGITAL_TWIN_MOTION,
} from '@/components/ClawAgents/digitalTwin/motion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/index';
import {
  DETAIL_SELECT_TRIGGER_CLASS_FOR,
  DetailRow,
  DetailValue,
  type DetailTypeScale,
} from '../../../shared/primitives/DetailPrimitives';

const TOGGLE_TRANSITION = {
  transitionDuration: `${DIGITAL_TWIN_MOTION.press}s`,
  transitionTimingFunction: `cubic-bezier(${DIGITAL_TWIN_EASE_OUT.join(',')})`,
} as const;

export function BehaviourRow({
  title,
  hint,
  children,
  last = false,
  typeScale = 'library',
}: {
  title: string;
  hint: string;
  children: ReactNode;
  last?: boolean;
  typeScale?: DetailTypeScale;
}): ReactElement {
  return (
    <DetailRow title={title} hint={hint} last={last} typeScale={typeScale}>
      {children}
    </DetailRow>
  );
}

/** Switch styled to the v2 language. Falls back to text when not editable. */
export function BehaviourToggle({
  checked,
  editable,
  disabled = false,
  label,
  trackName,
  onChange,
}: {
  checked: boolean;
  editable: boolean;
  disabled?: boolean;
  label: string;
  trackName: string;
  onChange: (next: boolean) => void;
}): ReactElement {
  if (!editable) return <DetailValue>{checked ? 'On' : 'Off'}</DetailValue>;

  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      style={TOGGLE_TRANSITION}
      className={cn(
        'relative inline-flex h-5 w-8 shrink-0 items-center overflow-clip rounded-full p-0.5',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
        checked ? 'bg-primary' : 'bg-foreground/[0.08]',
      )}
    >
      <span
        style={TOGGLE_TRANSITION}
        className={cn(
          'block size-4 shrink-0 rounded-full bg-primary-foreground',
          'shadow-[0_0_1.23px_rgba(0,0,0,0.03),0_1.23px_1.23px_rgba(0,0,0,0.03),0_3.7px_2.47px_rgba(0,0,0,0.02)]',
          'transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-3' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function BehaviourSelect({
  value,
  options,
  editable,
  disabled = false,
  label,
  trackName,
  onChange,
  typeScale = 'library',
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  editable: boolean;
  disabled?: boolean;
  label: string;
  trackName: string;
  onChange: (next: string) => void;
  typeScale?: DetailTypeScale;
}): ReactElement {
  const current = options.find(option => option.value === value);
  if (!editable) return <DetailValue>{current?.label ?? '—'}</DetailValue>;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className={DETAIL_SELECT_TRIGGER_CLASS_FOR[typeScale]}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align='end'>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Opens the dialog that carries a setting's detail fields. */
export function BehaviourEditButton({
  label,
  trackName,
  disabled = false,
  onClick,
}: {
  label: string;
  trackName: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
    >
      <PencilEditLine className='size-4' aria-hidden />
    </button>
  );
}
