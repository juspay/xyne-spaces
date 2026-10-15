import { memo, type ReactElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { FlowCardStepRow } from './flow-card-step-row';
import type { FlowCardStep, FlowCardStepIndicatorColors } from './flow-card.types';

type FlowCardStepListProps = {
  steps: FlowCardStep[];
  colors: FlowCardStepIndicatorColors;
  renderStepContent: (step: FlowCardStep) => ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  stepGap?: number;
};

const FlowCardStepListComponent = ({
  steps,
  colors,
  renderStepContent,
  containerStyle,
  stepGap = 8,
}: FlowCardStepListProps): ReactElement | null => {
  if (steps.length === 0) return null;

  return (
    <View style={[{ gap: stepGap, width: '100%', minWidth: 0 }, containerStyle]}>
      {steps.map(step => (
        <FlowCardStepRow key={step.id} status={step.status} colors={colors}>
          {renderStepContent(step)}
        </FlowCardStepRow>
      ))}
    </View>
  );
};

const FlowCardStepList = memo(FlowCardStepListComponent);
FlowCardStepList.displayName = 'FlowCardStepList';

export { FlowCardStepList };
