import { Check, X } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { FlowCardStepIndicatorColors, FlowCardStepStatus } from './flow-card.types';

const DOT_SIZE = 16;

type FlowCardStepIndicatorProps = {
  status: FlowCardStepStatus;
  colors: FlowCardStepIndicatorColors;
};

const FlowCardStepIndicatorComponent = ({
  status,
  colors,
}: FlowCardStepIndicatorProps): ReactElement => {
  if (status === 'done' || status === 'included') {
    return (
      <View
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: colors.checkedFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Check size={10} color={colors.checkIcon} strokeWidth={2.5} />
      </View>
    );
  }

  if (status === 'running') {
    return (
      <View
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size='small' color={colors.spinner} />
      </View>
    );
  }

  if (status === 'failed') {
    return (
      <View
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: colors.failedFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={10} color={colors.failedIcon} strokeWidth={2.5} />
      </View>
    );
  }

  return (
    <View
      style={{
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: DOT_SIZE / 2,
        borderWidth: 1.6,
        borderColor: colors.emptyBorder,
      }}
    />
  );
};

const FlowCardStepIndicator = memo(FlowCardStepIndicatorComponent);
FlowCardStepIndicator.displayName = 'FlowCardStepIndicator';

export { FlowCardStepIndicator, DOT_SIZE as FLOW_CARD_STEP_DOT_SIZE };
