import { useState, type ReactElement } from 'react';
import { ColorPalette } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Popover } from '@/components/ui/Popover';
import { COLORS } from '../create/wizardState';

interface AgentColorPickerProps {
  color: string;
  onChange: (next: string) => void;
}

export function AgentColorPicker({ color, onChange }: AgentColorPickerProps): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='start'
      sideOffset={8}
      className='w-auto rounded-xl border border-border p-2'
      trigger={
        <button
          type='button'
          aria-label='Change agent colour'
          title='Change agent colour'
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: open color picker'
          className='absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground'
        >
          <ColorPalette className='size-3' aria-hidden />
        </button>
      }
    >
      <div className='grid grid-cols-7 gap-1.5'>
        {COLORS.map(swatch => (
          <button
            key={swatch}
            type='button'
            onClick={() => {
              onChange(swatch);
              setOpen(false);
            }}
            aria-label={`Select colour ${swatch}`}
            aria-pressed={color === swatch}
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: select agent color'
            className={cn(
              'size-6 rounded-full transition',
              color === swatch
                ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
                : 'hover:scale-110',
            )}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    </Popover>
  );
}
