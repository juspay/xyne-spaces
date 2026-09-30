import { type ReactElement } from 'react';
import { Tools } from '@xyne/icons';
import { CapabilityChip } from '../CapabilityChip';

interface BuiltinChipProps {
  label: string;
  selected: boolean;
  onOpen?: () => void;
  onToggle: () => void;
}

export function BuiltinChip({ label, selected, onOpen, onToggle }: BuiltinChipProps): ReactElement {
  return (
    <CapabilityChip
      label={label}
      selected={selected}
      icon={<Tools className='size-4' aria-hidden />}
      {...(onOpen ? { onOpen } : {})}
      onToggle={onToggle}
      trackName='Create agent v2: toggle built-in chip'
    />
  );
}
