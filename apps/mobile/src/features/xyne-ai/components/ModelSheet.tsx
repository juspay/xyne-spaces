import type { ReactElement } from 'react';
import { Text } from 'react-native';

import type { XyneAIModel } from '../api/xyneAICatalog';
import type { ThinkingLevel } from '../api/xyneAIRequest';
import {
  THINKING_OPTIONS,
  autoModelDescription,
  modelLabel,
  modelSummary,
} from '../model/modelSelection';
import { OptionList, type Option } from './OptionList';
import { PickerSheet } from './PickerSheet';

export const ModelSheet = ({
  isOpen,
  onOpenChange,
  models,
  model,
  defaultModelName,
  thinkingLevel,
  onSelectModel,
  onSelectThinkingLevel,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  models: XyneAIModel[];
  model: string | undefined;
  defaultModelName: string | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  onSelectModel: (model: string | undefined) => void;
  onSelectThinkingLevel: (level: ThinkingLevel | undefined) => void;
}): ReactElement => {
  const selected = models.find(candidate => candidate.id === model);
  const modelOptions: Option<string>[] = [
    { value: undefined, label: 'Auto', description: autoModelDescription(defaultModelName) },
    ...models.map(candidate => ({
      value: candidate.id,
      label: modelLabel(candidate),
      ...(candidate.description && { description: candidate.description }),
    })),
  ];

  return (
    <PickerSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <Text className='px-1 text-[15px] leading-5 text-foreground'>{modelSummary(selected)}</Text>
      <OptionList title='Model' options={modelOptions} selected={model} onSelect={onSelectModel} />
      <OptionList
        title='Thinking'
        options={THINKING_OPTIONS}
        selected={thinkingLevel}
        onSelect={onSelectThinkingLevel}
      />
    </PickerSheet>
  );
};
