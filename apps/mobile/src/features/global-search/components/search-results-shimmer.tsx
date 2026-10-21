/**
 * The loading skeleton. `SearchList` renders it inside the list, as its empty
 * component, so it only shows when there are no rows to keep on screen.
 */

import { memo, useEffect, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const DEFAULT_ROW_COUNT = 6;

/**
 * Mirrors the real section header. A local copy rather than an import: `SearchList`
 * renders this shimmer, so importing its header back would make the files circular.
 */
const SkeletonSectionTitle = memo(function SkeletonSectionTitle({
  title,
}: {
  title: string;
}): ReactElement {
  return (
    <View className='flex-row items-center px-3 pb-2 pt-4'>
      <Text className='text-[13px] font-semibold uppercase tracking-wide text-secondary-foreground'>
        {title}
      </Text>
    </View>
  );
});

const ShimmerRow = memo(function ShimmerRow(): ReactElement {
  return (
    <View className='mx-2 mt-1 px-2 py-2.5'>
      <View className='flex-row items-start gap-2.5'>
        <View className='w-6 pt-0.5 items-center'>
          <View className='h-4 w-4 rounded-md bg-foreground/10' />
        </View>
        <View className='min-w-0 flex-1 gap-1.5'>
          <View className='flex-row items-center justify-between gap-2'>
            <View className='h-4 w-[48%] rounded-md bg-foreground/10' />
            <View className='h-3 w-14 rounded-md bg-foreground/8' />
          </View>
          <View className='h-3.5 w-[72%] rounded-md bg-foreground/8' />
          <View className='h-3 w-full rounded-md bg-foreground/8' />
          <View className='h-3 w-[58%] rounded-md bg-foreground/8' />
        </View>
      </View>
    </View>
  );
});

const CallShimmerRow = memo(function CallShimmerRow(): ReactElement {
  return (
    <View className='px-3 pb-6 min-h-16'>
      <View className='flex-row items-start gap-4'>
        <View className='h-10 w-10 rounded-xl bg-foreground/10' />
        <View className='min-w-0 flex-1 gap-2 pt-1'>
          <View className='h-4 w-[55%] rounded-md bg-foreground/10' />
          <View className='h-3.5 w-[40%] rounded-md bg-foreground/8' />
        </View>
        <View className='h-9 w-9 rounded-full bg-foreground/8 mt-0.5' />
      </View>
    </View>
  );
});

type SearchResultsShimmerProps = {
  listContentTop?: number;
  bottomContentInset?: number;
  rowCount?: number;
  /** Optional section label above the shimmer rows (e.g. Messages). */
  sectionTitle?: string;
  variant?: 'default' | 'call';
};

export const SearchResultsShimmer = memo(function SearchResultsShimmer({
  listContentTop = 0,
  bottomContentInset = 0,
  rowCount = DEFAULT_ROW_COUNT,
  sectionTitle,
  variant = 'default',
}: SearchResultsShimmerProps): ReactElement {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return (): void => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { flex: 1, paddingTop: listContentTop, paddingBottom: bottomContentInset },
        animatedStyle,
      ]}
      accessibilityLabel='Loading search results'
    >
      {sectionTitle ? <SkeletonSectionTitle title={sectionTitle} /> : null}
      {Array.from({ length: rowCount }, (_, index) =>
        variant === 'call' ? <CallShimmerRow key={index} /> : <ShimmerRow key={index} />,
      )}
    </Animated.View>
  );
});
