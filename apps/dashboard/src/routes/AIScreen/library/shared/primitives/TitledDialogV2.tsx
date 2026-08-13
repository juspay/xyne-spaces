import { type ReactElement, type ReactNode } from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Dialog } from '@/components/ui/Dialog/index';

const WIDTH = { form: 'max-w-[560px]', wide: 'max-w-[800px]' } as const;

interface TitledDialogV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  testId: string;
  width?: keyof typeof WIDTH;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function TitledDialogV2({
  open,
  onOpenChange,
  title,
  description,
  testId,
  width = 'form',
  footer,
  className,
  children,
}: TitledDialogV2Props): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      testId={testId}
      className={cn(
        'flex max-h-[min(85vh,720px)] w-full flex-col gap-4 overflow-hidden rounded-2xl border-[0.8px] border-border bg-card p-1',
        WIDTH[width],
        className,
      )}
    >
      <div className='flex h-9 shrink-0 items-center justify-between gap-2'>
        <span className='text-base font-semibold leading-6 tracking-[-0.16px] text-foreground'>
          {title}
        </span>
        <button
          type='button'
          onClick={() => onOpenChange(false)}
          aria-label='Close'
          data-track-category='Claw Agents'
          data-track-name={`Close dialog: ${title}`}
          className='flex size-7 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <MultipleCrossCancelDefault className='size-4' aria-hidden />
        </button>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto'>{children}</div>

      {footer && <div className='flex shrink-0 items-center justify-end gap-3'>{footer}</div>}
    </Dialog>
  );
}
