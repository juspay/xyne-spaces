import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button';
import { V2Dialog } from '../../create-v2/shared/V2Dialog';

interface BehaviourTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  hint?: string;
  testId: string;
  value: string;
  saving: boolean;
  onSave: (next: string) => void;
}

export function BehaviourTextDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  hint,
  testId,
  value,
  saving,
  onSave,
}: BehaviourTextDialogProps): ReactElement {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      testId={testId}
      footer={
        <>
          <Button
            variant='ghost'
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name={`Agent detail v2: cancel ${testId}`}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave(draft)}
            loading={saving}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name={`Agent detail v2: save ${testId}`}
          >
            Save
          </Button>
        </>
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>{description}</p>

      <section className='flex w-full flex-col gap-3'>
        <label
          htmlFor={`${testId}-field`}
          className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
        >
          {label}
        </label>
        <textarea
          id={`${testId}-field`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          data-track-category='Claw Agents'
          data-track-name={`Agent detail v2: ${testId} field`}
          className='h-[140px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
        />
        {hint && (
          <span className='text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
            {hint}
          </span>
        )}
      </section>
    </V2Dialog>
  );
}
