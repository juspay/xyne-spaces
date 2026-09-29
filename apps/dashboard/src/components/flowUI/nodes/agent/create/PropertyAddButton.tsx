import type { ReactElement } from 'react';
import { PlusDefault } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';

interface PropertyAddButtonProps {
  onClick: () => void;
  /** Screen reader name. Visible label stays "Add". */
  label: string;
  trackName: string;
  disabled?: boolean;
  className?: string;
}

/** Figma "+ Add" chip: 61×26, dashed, 8px radius. Opens an existing picker. */
export function PropertyAddButton({
  onClick,
  label,
  trackName,
  disabled = false,
  className,
}: PropertyAddButtonProps): ReactElement {
  return (
    <Button
      type='button'
      variant='ghost'
      size='inline'
      disabled={disabled}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      onClick={onClick}
      className={cn(
        'h-[26px] w-fit gap-1.5 self-start rounded-[8px] border-[0.8px] border-dashed border-border bg-background py-0 pl-1 pr-1.5 font-[450] leading-[1.3] tracking-[-0.1px] text-muted-foreground hover:bg-accent hover:text-muted-foreground',
        className,
      )}
    >
      <PlusDefault size={16} variant='Stroke' aria-hidden />
      Add
    </Button>
  );
}
