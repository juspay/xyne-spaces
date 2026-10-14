import { type ReactElement, type ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { ArrowLeft, X } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import { GlassButton } from '@/src/components/ui/glass-button';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';

/**
 * The action bar every section sheet wears: a leading control, a centred title
 * (with an optional subtitle naming the section), and the step's primary action
 * as an accent pill on the trailing edge. Mirrors the create-channel drawer's
 * bar so the two flows read as one family — including its materials, so both
 * controls are liquid glass on the iOS versions that have it and flat fills
 * everywhere else.
 *
 * The pill lives up here rather than in a footer so a list step can hand its
 * entire remaining height to the list, keyboard up or not.
 */

/**
 * Both side slots reserve the same width so the title stays optically centred
 * as the action label changes between steps ('Create' -> 'Done').
 */
const SIDE_SLOT_MIN_WIDTH = 92;

const CONTROL_HEIGHT = 40;
const CONTROL_RADIUS = 20;

type SectionSheetHeaderProps = {
  /**
   * 'back' on a step that has somewhere to return to, 'skip' on an optional
   * one whose work is already banked, 'close' otherwise.
   */
  leading: 'close' | 'back' | 'skip';
  onLeadingPress: () => void;
  isLeadingDisabled?: boolean;
  title: string;
  subtitle?: string | null | undefined;
  actionLabel: string;
  onActionPress: () => void;
  isActionDisabled?: boolean;
  /** Hairline under the bar. On for list steps, off for the compact card. */
  withDivider?: boolean;
};

export function SectionSheetHeader({
  leading,
  onLeadingPress,
  isLeadingDisabled = false,
  title,
  subtitle,
  actionLabel,
  onActionPress,
  isActionDisabled = false,
  withDivider = false,
}: SectionSheetHeaderProps): ReactElement {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg, accentFg } = useBubbleAccent();
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  const LeadingIcon = leading === 'back' ? ArrowLeft : X;
  const isSkip = leading === 'skip';

  /* An optional step says 'Skip' in words — a ✕ there would read as "throw
     this away", when what it does is leave finished work be — but it keeps the
     secondary weight of the ✕ it stands in for. */
  const leadingContent = isSkip ? (
    <Text className='px-3.5 text-[15px] font-medium' style={{ color: headerColor }}>
      Skip
    </Text>
  ) : (
    <LeadingIcon size={20} color={headerColor} strokeWidth={2.2} />
  );

  const actionContent = (
    <Text className='px-4 text-[15px] font-semibold' style={{ color: accentFg }}>
      {actionLabel}
    </Text>
  );

  const leadingLabel = isSkip ? 'Skip' : leading === 'back' ? 'Go back' : 'Close';

  if (Platform.OS === 'ios') {
    return (
      <HeaderRow withDivider={withDivider} title={title} subtitle={subtitle}>
        {{
          leading: (
            <GlassButton
              onPress={onLeadingPress}
              disabled={isLeadingDisabled}
              isDark={isDark}
              height={CONTROL_HEIGHT}
              borderRadius={CONTROL_RADIUS}
              {...(isSkip ? {} : { size: CONTROL_HEIGHT })}
            >
              {leadingContent}
            </GlassButton>
          ),
          action: (
            <GlassButton
              onPress={onActionPress}
              disabled={isActionDisabled}
              isDark={isDark}
              height={CONTROL_HEIGHT}
              borderRadius={CONTROL_RADIUS}
              fillColor={accentBg}
            >
              {actionContent}
            </GlassButton>
          ),
        }}
      </HeaderRow>
    );
  }

  return (
    <HeaderRow withDivider={withDivider} title={title} subtitle={subtitle}>
      {{
        leading: (
          <Pressable
            onPress={onLeadingPress}
            disabled={isLeadingDisabled}
            hitSlop={8}
            accessibilityRole='button'
            accessibilityLabel={leadingLabel}
            accessibilityState={{ disabled: isLeadingDisabled }}
            className={cn(
              'items-center justify-center rounded-full bg-bottomsheet-container-bg',
              isLeadingDisabled ? 'opacity-35' : 'active:opacity-60',
            )}
            style={{ height: CONTROL_HEIGHT, ...(isSkip ? {} : { width: CONTROL_HEIGHT }) }}
          >
            {leadingContent}
          </Pressable>
        ),
        action: (
          <Pressable
            onPress={onActionPress}
            disabled={isActionDisabled}
            accessibilityRole='button'
            accessibilityState={{ disabled: isActionDisabled }}
            className={cn(
              'items-center justify-center rounded-full',
              isActionDisabled ? 'opacity-35' : 'active:opacity-70',
            )}
            style={{ height: CONTROL_HEIGHT, backgroundColor: accentBg }}
          >
            {actionContent}
          </Pressable>
        ),
      }}
    </HeaderRow>
  );
}

function HeaderRow({
  title,
  subtitle,
  withDivider,
  children,
}: {
  title: string;
  subtitle?: string | null | undefined;
  withDivider: boolean;
  children: { leading: ReactNode; action: ReactNode };
}): ReactElement {
  return (
    <View
      className={cn(
        'flex-row items-center px-4 pb-3 pt-1',
        withDivider && 'border-b border-border',
      )}
    >
      <View style={{ minWidth: SIDE_SLOT_MIN_WIDTH }} className='items-start'>
        {children.leading}
      </View>

      <View className='flex-1 items-center px-1'>
        <Text className='text-base font-semibold text-bottomsheet-text-header' numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className='mt-0.5 text-xs text-bottomsheet-text-muted' numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={{ minWidth: SIDE_SLOT_MIN_WIDTH }} className='items-end'>
        {children.action}
      </View>
    </View>
  );
}
