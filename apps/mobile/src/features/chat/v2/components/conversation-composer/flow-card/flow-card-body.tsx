import { memo, type ReactElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

type FlowCardBodyProps = {
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  gap?: number;
};

const FlowCardBodyComponent = ({
  children,
  containerStyle,
  gap = 6,
}: FlowCardBodyProps): ReactElement => {
  return (
    <View style={[{ alignSelf: 'stretch', width: '100%', minWidth: 0, gap }, containerStyle]}>
      {children}
    </View>
  );
};

const FlowCardBody = memo(FlowCardBodyComponent);
FlowCardBody.displayName = 'FlowCardBody';

export { FlowCardBody };
