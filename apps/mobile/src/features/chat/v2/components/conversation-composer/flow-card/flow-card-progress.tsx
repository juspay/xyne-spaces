import { memo, type ReactElement } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

type FlowCardProgressProps = {
  completedCount: number;
  totalCount: number;
  label?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

const defaultLabel = (completedCount: number, totalCount: number): string =>
  `${completedCount} of ${totalCount} completed`;

const FlowCardProgressComponent = ({
  completedCount,
  totalCount,
  label,
  containerStyle,
}: FlowCardProgressProps): ReactElement | null => {
  if (totalCount <= 0) return null;

  return (
    <View style={containerStyle}>
      <Text className='mb-1 text-[14px] font-medium leading-[18px] text-flow-card-progress-text'>
        {label ?? defaultLabel(completedCount, totalCount)}
      </Text>
    </View>
  );
};

const FlowCardProgress = memo(FlowCardProgressComponent);
FlowCardProgress.displayName = 'FlowCardProgress';

export { FlowCardProgress };
