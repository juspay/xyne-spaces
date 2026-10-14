import { forwardRef } from 'react';
import { View, type ViewProps } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

interface SafeAreaViewProps extends ViewProps {
  edges?: readonly Edge[];
}

/** Drop-in replacement for `SafeAreaView` that honors the call bar's inset override. */
const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

export const SafeAreaView = forwardRef<View, SafeAreaViewProps>(function SafeAreaView(
  { edges = ALL_EDGES, style, ...props },
  ref,
) {
  const insets = useSafeAreaInsets();

  return (
    <View
      ref={ref}
      style={[
        {
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingRight: edges.includes('right') ? insets.right : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          paddingLeft: edges.includes('left') ? insets.left : 0,
        },
        style,
      ]}
      {...props}
    />
  );
});
