import { type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { formatCountLabel } from '@/src/utils/countLabel';
import type { BadgeProps } from './badge.types';

export const Badge = ({
  label,
  count,
  variant = 'default',
  className,
  trailing,
  ...rest
}: BadgeProps): ReactElement => {
  // The selected pill follows the user's chat bubble colour: a soft tint behind
  // accent-coloured text, held to the text contrast floor against the screen.
  const { accentSoft, accentText } = useBubbleAccent();
  const isActive = variant === 'active';
  const showCount = typeof count === 'number' && count > 0;
  const countLabel = formatCountLabel(count ?? 0);

  const textClassName = cn(
    'text-[16px]',
    isActive ? 'font-bold' : 'text-tab-inactive-text font-semibold',
  );
  const textStyle = isActive ? { color: accentText } : undefined;

  return (
    <Pressable
      className={cn(
        'flex-row items-center gap-1 py-1.5 px-3 rounded-full border-[0.5px]',
        isActive ? '' : 'bg-card border-foreground/15',
        className,
      )}
      {...(isActive ? { style: { backgroundColor: accentSoft, borderColor: accentText } } : {})}
      {...rest}
    >
      {/*
        Single line always. A badge is a pill, and a label long enough to wrap
        would push it past the fixed row heights the search toolbar reserves.
      */}
      <Text className={cn(textClassName, 'min-w-0 shrink')} style={textStyle} numberOfLines={1}>
        {label}
      </Text>
      {showCount && (
        <Text className={textClassName} style={textStyle}>
          {countLabel}
        </Text>
      )}
      {trailing}
    </Pressable>
  );
};

export default Badge;
