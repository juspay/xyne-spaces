import { type ReactElement, type ReactNode } from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { Button } from '@/components/ui/Button/index';
import { Dialog } from '@/components/ui/Dialog/index';
import { Pill } from '../../shared/primitives/Pill';
import { Separator } from '../../shared/primitives/Section';

const MetaRow = ({ label, children }: { label: string; children: ReactNode }): ReactElement => (
  <div className='flex h-7 w-full items-center justify-between gap-3'>
    <span className='shrink-0 text-sm font-medium leading-[1.2] text-muted-foreground'>
      {label}
    </span>
    <span className='min-w-0 truncate text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
      {children}
    </span>
  </div>
);

interface SubagentReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  description: string;
  paramName: string;
  toolCount: number;
  skillCount: number;
  error: string | null;
  isPending: boolean;
  onConfirm: () => void;
}

export function SubagentReviewDialog({
  open,
  onOpenChange,
  name,
  description,
  paramName,
  toolCount,
  skillCount,
  error,
  isPending,
  onConfirm,
}: SubagentReviewDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Review'
      description='Take a last look before creating.'
      testId='subagent-review-dialog'
      className='flex w-full max-w-[560px] flex-col gap-4 overflow-hidden rounded-2xl border-[0.8px] border-border bg-card p-1'
    >
      <div className='flex h-9 shrink-0 items-center justify-between gap-2 pl-[18px] pr-2'>
        <span className='text-base font-semibold leading-6 tracking-[-0.16px] text-foreground'>
          Review
        </span>
        <button
          type='button'
          onClick={() => onOpenChange(false)}
          aria-label='Close'
          data-track-category='Claw Agents'
          data-track-name='Create subagent v2: close review'
          className='flex size-7 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <MultipleCrossCancelDefault className='size-4' aria-hidden />
        </button>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] pb-2'>
        <div className='flex w-full min-w-0 flex-col gap-1.5'>
          <span className='flex min-w-0 items-center gap-1.5'>
            <span className='truncate text-sm font-semibold leading-[1.3] tracking-[-0.28px] text-foreground'>
              {name}
            </span>
            <Pill tone='neutral'>Custom</Pill>
          </span>
          <p className='text-sm font-normal leading-5 tracking-[-0.28px] text-muted-foreground'>
            {description || 'No description added'}
          </p>
        </div>

        <Separator />

        <div className='flex w-full flex-col gap-2'>
          <MetaRow label='Parameter'>{paramName}</MetaRow>
          <MetaRow label='Tools'>{toolCount}</MetaRow>
          <MetaRow label='Skills'>{skillCount}</MetaRow>
        </div>

        {error && <p className='text-sm font-normal leading-5 text-destructive'>{error}</p>}
      </div>

      <div className='flex shrink-0 items-center justify-end gap-3 px-[22px] pb-3'>
        <Button
          variant='ghost'
          onClick={() => onOpenChange(false)}
          disabled={isPending}
          className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
          data-track-category='Claw Agents'
          data-track-name='Create subagent v2: cancel from review'
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          loading={isPending}
          className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
          data-track-category='Claw Agents'
          data-track-name='Create subagent v2: confirm create'
        >
          Create
        </Button>
      </div>
    </Dialog>
  );
}
