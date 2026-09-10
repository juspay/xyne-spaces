import type { ReactElement } from 'react';
import { CheckTickSingle, ChevronDown } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import {
  getRecordingDatePresetLabel,
  RECORDING_DATE_PRESETS,
  type RecordingDatePreset,
} from '../utils/RecordingsV2.utils';

interface RecordingDateFilterProps {
  value: RecordingDatePreset;
  onChange: (value: RecordingDatePreset) => void;
}

export function RecordingDateFilter({ value, onChange }: RecordingDateFilterProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          className='h-9 gap-1 rounded-xl border-border px-3 font-medium shadow-none'
          data-track-category='RecordingsV2'
          data-track-name='open_date_filter'
        >
          {getRecordingDatePresetLabel(value)}
          <ChevronDown className='size-4 text-muted-foreground' aria-hidden='true' />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align='start' className='min-w-40'>
        {RECORDING_DATE_PRESETS.map(option => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className='justify-between'
            data-track-category='RecordingsV2'
            data-track-name={`filter_date_${option.value}`}
          >
            {option.label}
            {value === option.value && (
              <CheckTickSingle className='size-4 text-foreground' aria-hidden='true' />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
