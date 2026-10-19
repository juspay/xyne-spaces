import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

type Props = {
  tabsLength: number; // Total number of tabs for array initialization
  sidePadding: number; // Horizontal padding affecting first tab position
  gap: number; // Space between tabs used in offset calculations
};

/**
 * Dynamic tab layout measurement system for responsive indicator positioning
 * Calculates tab positions and widths for smooth animations
 */
const useMeasureFlatListTabsLayout = ({ tabsLength, sidePadding, gap }: Props) => {
  // CRITICAL: Tab widths must be measured via onLayout in each tab component:
  // onLayout={(event) => {
  //   const { width } = event.nativeEvent.layout;
  //   tabWidths.modify((value) => {
  //     "worklet"; // Enables UI thread updates for smooth animations
  //     value[index] = width; // Updates shared array for indicator calculations
  //     return value;
  //   });
  // }}

  // Shared array stores actual measured tab widths (initially 0, updated via onLayout)
  const tabWidths = useSharedValue<number[]>(new Array(tabsLength).fill(0));

  // Derived value automatically recalculates tab positions when widths change
  const tabOffsets = useDerivedValue(() => {
    return tabWidths.value.reduce<number[]>((acc, _width, index) => {
      // Calculate left position for each tab based on previous tabs
      const previousX = index === 0 ? sidePadding : acc[index - 1]; // Start with padding or previous position
      const previousWidth = index === 0 ? 0 : tabWidths.value[index - 1]; // No width for first tab calculation

      // Formula: previousPosition + previousWidth + gap (except first tab)
      acc[index] = (previousX ?? 0) + (previousWidth ?? 0) + (index === 0 ? 0 : gap);
      return acc;
    }, []);
  });

  return { tabWidths, tabOffsets };
};

export { useMeasureFlatListTabsLayout };
