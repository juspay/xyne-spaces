import { memo, type ReactElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { FlowCardStepIndicator, FLOW_CARD_STEP_DOT_SIZE } from './flow-card-step-indicator';
import type { FlowCardStepIndicatorColors, FlowCardStepStatus } from './flow-card.types';

const DOT_COLUMN_WIDTH = 24;
const DOT_COLUMN_GAP = 7;

type FlowCardStepRowProps = {
  status: FlowCardStepStatus;
  colors: FlowCardStepIndicatorColors;
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
};

const FlowCardStepRowComponent = ({
  status,
  colors,
  children,
  containerStyle,
}: FlowCardStepRowProps): ReactElement => {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          width: '100%',
          minWidth: 0,
        },
        containerStyle,
      ]}
    >
      <View
        style={{
          width: DOT_COLUMN_WIDTH,
          alignItems: 'center',
          paddingTop: 1,
          marginRight: DOT_COLUMN_GAP,
          flexShrink: 0,
        }}
      >
        <FlowCardStepIndicator status={status} colors={colors} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
};

const FlowCardStepRow = memo(FlowCardStepRowComponent);
FlowCardStepRow.displayName = 'FlowCardStepRow';

export {
  FlowCardStepRow,
  DOT_COLUMN_GAP as FLOW_CARD_STEP_DOT_GAP,
  DOT_COLUMN_WIDTH as FLOW_CARD_STEP_DOT_COLUMN_WIDTH,
  FLOW_CARD_STEP_DOT_SIZE,
};
