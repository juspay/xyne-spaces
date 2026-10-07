import { type ReactElement } from 'react';
import { UserBot } from '@xyne/icons';
import { CapabilityChip } from '../CapabilityChip';

interface SubagentChipProps {
  label: string;
  selected: boolean;
  onOpen?: () => void;
  onToggle: () => void;
}

export function SubagentChip({
  label,
  selected,
  onOpen,
  onToggle,
}: SubagentChipProps): ReactElement {
  return (
    <CapabilityChip
      label={label}
      selected={selected}
      icon={<UserBot className='size-4' aria-hidden />}
      {...(onOpen ? { onOpen } : {})}
      onToggle={onToggle}
      trackName='Create agent v2: toggle subagent chip'
    />
  );
}
