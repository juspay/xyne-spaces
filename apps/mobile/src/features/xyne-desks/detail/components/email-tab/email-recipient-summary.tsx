import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { EMAIL_DETAILS_CHEVRON_MS } from '../../constants';
import type { TicketDetailEmailSnapshot } from '../../types';
import { formatEmailHeaderDate, summarizeRecipients } from '../../utils';
import { parseTicketSender } from '../../../tickets/utils';

type EmailRecipientSummaryProps = {
  email: TicketDetailEmailSnapshot;
  deskEmail: string | null;
};

export const EmailRecipientSummary = memo(function EmailRecipientSummary({
  email,
  deskEmail,
}: EmailRecipientSummaryProps) {
  const [open, setOpen] = useState(false);
  const rotation = useSharedValue(0);
  const foreground = useCSSVariable('--color-foreground') as string;

  const { senderName, email: fromEmail } = parseTicketSender(email.from);
  const summary = summarizeRecipients(email.to, email.cc, deskEmail);
  const date = formatEmailHeaderDate(email.createdAt);

  const fromValues: string[] = [];
  if (senderName && fromEmail) fromValues.push(`${senderName} <${fromEmail}>`);
  else if (fromEmail) fromValues.push(fromEmail);
  else if (senderName) fromValues.push(senderName);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    rotation.value = withTiming(next ? 180 : 0, { duration: EMAIL_DETAILS_CHEVRON_MS });
  };

  return (
    <View>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={open ? 'Hide recipient details' : 'Show recipient details'}
        hitSlop={6}
        onPress={toggle}
        className='mt-0.5 flex-row items-center gap-1 self-start'
      >
        <Text className='max-w-[90%] text-[12px] text-foreground/70' numberOfLines={1}>
          {summary.label}
        </Text>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={14} color={foreground} />
        </Animated.View>
      </Pressable>

      {open ? (
        <View className='mt-2 rounded-xl bg-neutral-200/80 p-3 dark:bg-accent/50'>
          <DetailRow label='From' values={fromValues} />
          <DetailRow label='To' values={email.to} />
          {email.cc.length > 0 ? <DetailRow label='Cc' values={email.cc} /> : null}
          {email.bcc.length > 0 ? <DetailRow label='Bcc' values={email.bcc} /> : null}
          <DetailRow label='Date' values={[date.full]} />
        </View>
      ) : null}
    </View>
  );
});

function DetailRow({ label, values }: { label: string; values: readonly string[] }) {
  if (!values.length) return null;
  return (
    <View className='mb-1.5 flex-row items-start gap-3 last:mb-0'>
      <Text className='w-12 shrink-0 pt-0.5 text-[12px] text-foreground/60'>{label}</Text>
      <Text className='min-w-0 flex-1 text-[13px] text-foreground'>{values.join(', ')}</Text>
    </View>
  );
}
