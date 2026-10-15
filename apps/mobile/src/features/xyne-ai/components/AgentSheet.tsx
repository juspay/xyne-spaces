import type { ReactElement } from 'react';

import type { XyneAIAgent } from '../api/xyneAICatalog';
import { AgentDot } from './AgentDot';
import { OptionList, type Option } from './OptionList';
import { PickerSheet } from './PickerSheet';

export const AgentSheet = ({
  isOpen,
  onOpenChange,
  agents,
  selected,
  onSelect,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  agents: XyneAIAgent[];
  selected: string | undefined;
  onSelect: (slug: string | undefined) => void;
}): ReactElement => {
  const options: Option<string>[] = [
    { value: undefined, label: 'Ask AI', leading: <AgentDot color={undefined} /> },
    ...agents.map(agent => ({
      value: agent.slug,
      label: agent.name,
      leading: <AgentDot color={agent.color} />,
    })),
  ];

  return (
    <PickerSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <OptionList title='Agent' options={options} selected={selected} onSelect={onSelect} />
    </PickerSheet>
  );
};
