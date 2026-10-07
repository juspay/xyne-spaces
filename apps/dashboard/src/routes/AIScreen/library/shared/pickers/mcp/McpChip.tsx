import { type ReactElement } from 'react';
import { CapabilityChip } from '../CapabilityChip';
import { McpIdentity } from './McpIdentity';

interface McpChipProps {
  label: string;
  iconType: string;
  selected: boolean;
  onOpen?: () => void;
  onToggle: () => void;
}

export function McpChip({
  label,
  iconType,
  selected,
  onOpen,
  onToggle,
}: McpChipProps): ReactElement {
  return (
    <CapabilityChip
      label={label}
      selected={selected}
      content={
        <McpIdentity
          label={label}
          iconType={iconType}
          gap='tight'
          weight='pill'
          muted={!selected}
        />
      }
      {...(onOpen ? { onOpen } : {})}
      onToggle={onToggle}
      trackName='Create agent v2: toggle MCP chip'
    />
  );
}
