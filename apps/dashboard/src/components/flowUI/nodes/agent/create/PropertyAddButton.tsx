import type { ReactElement } from 'react';
import { PlusDefault } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { DashedOutline } from './DashedOutline';

interface PropertyAddButtonProps {
  onClick: () => void;
  /** Screen reader name. Visible label stays "Add". */
  label: string;
  trackName: string;
  disabled?: boolean;
  className?: string;
}

/**
 * "+ Add" chip: dashed, opens an existing picker. Same height and corner
 * radius as the capability pills (36px, 12px) whether or not the row has any,
 * so it never changes size as pills come and go.
 */
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
      data-property-add=''
      onClick={onClick}
      className={cn(
        'relative h-9 w-fit gap-1.5 self-start rounded-xl bg-background py-0 pl-2 pr-2.5 font-[450] leading-[1.3] tracking-[-0.1px] text-muted-foreground hover:bg-accent hover:text-muted-foreground',
        className,
      )}
    >
      <DashedOutline />
      <PlusDefault size={16} variant='Stroke' aria-hidden />
      Add
    </Button>
  );
}
