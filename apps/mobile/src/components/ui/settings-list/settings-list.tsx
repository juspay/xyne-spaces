import { type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';

/**
 * The grouped-list building blocks shared by the settings-styled screens
 * (account settings, conversation info, about, channel settings, user profile).
 * Everything is driven by the `--color-settings-*` tokens, which are defined for
 * both light and dark, so screens built from these are theme-correct by default.
 */

/** Left inset for dividers so they start under the label, not the icon. */
export const LIST_ROW_DIVIDER_INSET = 58;

export const SectionLabel = ({ children }: { children: string }): ReactElement => {
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  return (
    <Text
      className='mb-2 ml-4 text-xs font-semibold uppercase tracking-wide'
      style={{ color: descriptionColor }}
    >
      {children}
    </Text>
  );
};

export const SectionFootnote = ({ children }: { children: string }): ReactElement => {
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  return (
    <Text className='mx-4 mt-2 text-xs' style={{ color: descriptionColor }}>
      {children}
    </Text>
  );
};

export const SectionCard = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}): ReactElement => (
  <View className={`overflow-hidden rounded-2xl bg-settings-section-bg ${className ?? ''}`}>
    {children}
  </View>
);

export const ListRowDivider = ({
  inset = LIST_ROW_DIVIDER_INSET,
}: {
  inset?: number;
}): ReactElement => {
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  return <View className='h-px' style={{ marginLeft: inset, backgroundColor: dividerColor }} />;
};

export type ListRowProps = {
  icon?: LucideIcon | undefined;
  /** Custom leading element (e.g. an Avatar) rendered in place of `icon`. */
  leading?: ReactElement | undefined;
  label: string;
  /** Secondary line under the label. */
  description?: string | undefined;
  /** Right-aligned value. Ignored when `children` is provided. */
  value?: string | undefined;
  /** Stacked content under the label — copyable values, inline editors, etc. */
  children?: ReactNode | undefined;
  trailing?: ReactElement | undefined;
  destructive?: boolean | undefined;
  showChevron?: boolean | undefined;
  onPress?: (() => void) | undefined;
};

export const ListRow = ({
  icon: Icon,
  leading,
  label,
  description,
  value,
  children,
  trailing,
  destructive,
  showChevron,
  onPress,
}: ListRowProps): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const chevronColor = useCSSVariable('--color-settings-chevron') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const dangerColor = useCSSVariable('--color-settings-icon-red') as string;
  const color = destructive ? dangerColor : labelColor;

  const content = (
    <View className='min-h-[56px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4'>
      {leading || Icon ? (
        <View className='h-9 w-9 shrink-0 items-center justify-center'>
          {leading ??
            (Icon ? (
              <Icon
                size={21}
                color={destructive ? dangerColor : descriptionColor}
                strokeWidth={2.1}
              />
            ) : null)}
        </View>
      ) : null}

      <View className='min-w-0 flex-1'>
        <Text className='text-base' style={{ color }} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text className='mt-0.5 text-xs' style={{ color: descriptionColor }} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
        {children ? <View className='mt-1'>{children}</View> : null}
      </View>

      {!children && value ? (
        <Text
          className='max-w-[45%] text-right text-sm'
          style={{ color: descriptionColor }}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {trailing ?? null}
      {showChevron ? <ChevronRight size={19} color={chevronColor} strokeWidth={2.5} /> : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      accessibilityRole='button'
      accessibilityLabel={label}
      android_ripple={{ color: dividerColor }}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      {content}
    </Pressable>
  );
};
