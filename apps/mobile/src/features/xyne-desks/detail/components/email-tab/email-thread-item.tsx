import { memo, useCallback, useMemo } from 'react';
import {
  Pressable,
  Text,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Paperclip } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  getTicketAvatarColor,
  getTicketAvatarInitial,
  parseTicketSender,
} from '../../../tickets/utils';
import { EMAIL_AVATAR_SIZE, EMAIL_CHAIN_ROW_GAP } from '../../constants';
import type { EmailChainItemPosition, TicketDetailEmailSnapshot } from '../../types';
import { buildEmailPreview, formatEmailHeaderDate, getEmailChainBorderRadius } from '../../utils';
import { EmailBody } from './email-body';
import { EmailAttachmentsRow } from './email-attachments-row';
import { EmailRecipientSummary } from './email-recipient-summary';

type EmailThreadItemProps = {
  email: TicketDetailEmailSnapshot;
  position: EmailChainItemPosition;
  isCollapsed: boolean;
  isLast: boolean;
  deskEmail: string | null;
  conversationId: string | null;
  showEmailHeaderChrome?: boolean;
  onToggleCollapse: () => void;
};

export const EmailThreadItem = memo(function EmailThreadItem({
  email,
  position,
  isCollapsed,
  isLast,
  deskEmail,
  conversationId,
  showEmailHeaderChrome = true,
  onToggleCollapse,
}: EmailThreadItemProps) {
  const scheme = useColorScheme();
  const { senderName, email: fromEmail } = parseTicketSender(email.from);
  const displayName = senderName || fromEmail || 'Unknown';
  const avatarColor = getTicketAvatarColor(fromEmail || displayName || email.id);
  const initial = getTicketAvatarInitial(displayName);
  const date = formatEmailHeaderDate(email.createdAt);
  const preview = useMemo(() => buildEmailPreview(email.body), [email.body]);
  const borderRadius = useMemo(() => getEmailChainBorderRadius(position), [position]);

  const cardBg = useCSSVariable('--color-card') as string;
  // Match tickets-list selection wash: neutral-200 light / accent dark.
  const pressBgLight = useCSSVariable('--color-neutral-200') as string;
  const pressBgDark = useCSSVariable('--color-accent') as string;
  const pressedBackground = useMemo(() => {
    if (scheme === 'dark') {
      return isResolvedColor(pressBgDark) ? pressBgDark : '#404040';
    }
    return isResolvedColor(pressBgLight) ? pressBgLight : '#e5e5e5';
  }, [scheme, pressBgLight, pressBgDark]);

  const handleToggle = useCallback(() => {
    onToggleCollapse();
  }, [onToggleCollapse]);

  const cardStyle = useMemo(
    () =>
      ({
        ...borderRadius,
        overflow: 'hidden' as const,
        marginBottom: isLast ? 0 : EMAIL_CHAIN_ROW_GAP,
        backgroundColor: isResolvedColor(cardBg) ? cardBg : undefined,
      }) satisfies ViewStyle,
    [borderRadius, isLast, cardBg],
  );

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
      cardStyle,
      pressed ? { backgroundColor: pressedBackground } : null,
    ],
    [cardStyle, pressedBackground],
  );

  if (isCollapsed) {
    return (
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`${displayName}, collapsed email, double tap to expand`}
        onPress={handleToggle}
        className='px-3 py-3'
        style={pressableStyle}
      >
        <View className='flex-row gap-3'>
          <AvatarCircle color={avatarColor} initial={initial} />
          <View className='min-w-0 flex-1'>
            <View className='flex-row items-center gap-2'>
              <Text
                className='min-w-0 flex-1 text-[15px] font-semibold text-foreground'
                numberOfLines={1}
              >
                {displayName}
              </Text>
              {(email.attachments?.length ?? 0) > 0 ? (
                <Paperclip size={13} color='#A1A1AA' strokeWidth={2.2} />
              ) : null}
              <Text className='text-[12px] text-foreground/70'>{date.short}</Text>
            </View>
            <Text className='mt-0.5 text-[13px] leading-4 text-foreground/70' numberOfLines={2}>
              {preview || ' '}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={cardStyle}>
      {/* Header is the collapse target — full-width press wash like Gmail */}
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`${displayName}, expanded email, double tap to collapse`}
        onPress={handleToggle}
        className='px-3 pt-4'
        style={({ pressed }) => (pressed ? { backgroundColor: pressedBackground } : null)}
      >
        <View className='flex-row gap-3'>
          <AvatarCircle color={avatarColor} initial={initial} />
          <View className='min-w-0 flex-1'>
            <View className='flex-row items-center gap-2'>
              <Text
                className='min-w-0 flex-1 text-[15px] font-semibold text-foreground'
                numberOfLines={1}
              >
                {displayName}
              </Text>
              <Text className='text-[12px] text-foreground/70'>{date.short}</Text>
            </View>
            {/* Nested Pressable for chevron — does not collapse the email */}
            {showEmailHeaderChrome ? (
              <EmailRecipientSummary email={email} deskEmail={deskEmail} />
            ) : null}
          </View>
        </View>
      </Pressable>

      {/* Body starts at the left card edge — no avatar column indent */}
      <View className='px-3 pb-4'>
        <EmailBody body={email.body} />
        <EmailAttachmentsRow
          attachments={email.attachments ?? []}
          body={email.body}
          conversationId={conversationId}
        />
      </View>
    </View>
  );
});

function AvatarCircle({ color, initial }: { color: string; initial: string }) {
  return (
    <View
      className='items-center justify-center rounded-full'
      style={{
        width: EMAIL_AVATAR_SIZE,
        height: EMAIL_AVATAR_SIZE,
        backgroundColor: color,
      }}
    >
      <Text className='text-[15px] font-semibold text-white'>{initial}</Text>
    </View>
  );
}

function isResolvedColor(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(');
}
