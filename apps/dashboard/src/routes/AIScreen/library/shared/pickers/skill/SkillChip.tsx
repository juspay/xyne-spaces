import { type ReactElement } from 'react';
import { CapabilityChip } from '../CapabilityChip';

interface SkillChipProps {
  label: string;
  selected: boolean;
  onOpen?: () => void;
  onToggle: () => void;
}

export function SkillChip({ label, selected, onOpen, onToggle }: SkillChipProps): ReactElement {
  return (
    <CapabilityChip
      label={label}
      selected={selected}
      {...(onOpen ? { onOpen } : {})}
      onToggle={onToggle}
      trackName='Create agent v2: toggle skill chip'
    />
  );
}
