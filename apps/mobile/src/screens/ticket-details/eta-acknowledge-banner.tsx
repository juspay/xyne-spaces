import type { EtaManagementView } from '@xyne/shared';
import { useCallback, useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { formatETADisplay } from './eta-display';

type EtaAcknowledgeBannerProps = {
  view: EtaManagementView;
  onAcknowledge: (reason: string) => Promise<boolean>;
};

export function EtaAcknowledgeBanner({
  view,
  onAcknowledge,
}: EtaAcknowledgeBannerProps): ReactElement | null {
  const { accentBg } = useBubbleAccent();
  const [showInput, setShowInput] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = useCallback(async (): Promise<void> => {
    const trimmed = reason.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onAcknowledge(trimmed);
      if (ok) {
        setShowInput(false);
        setReason('');
      }
    } finally {
      setSubmitting(false);
    }
  }, [onAcknowledge, reason, submitting]);

  if (view.severity !== 'PLANNING_RISK' || view.planningRiskState !== 'ACTIVE') {
    return null;
  }

  const stageDeadlineLabel = view.stageDeadline ? formatETADisplay(view.stageDeadline) : null;
  const ticketDueLabel = view.ticketDue ? formatETADisplay(view.ticketDue) : null;

  return (
    <View className='mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5'>
      <View className='flex-row items-start justify-between gap-2'>
        <View className='min-w-0 flex-1'>
          <Text className='text-sm font-medium text-amber-900'>Planning risk</Text>
          <Text className='mt-0.5 text-xs text-amber-800'>
            The current stage deadline
            {stageDeadlineLabel ? ` (${stageDeadlineLabel})` : ''} is later than the ticket due date
            {ticketDueLabel ? ` (${ticketDueLabel})` : ''}.
            {view.autoEnabled
              ? ' Automatic recalculation is active for this board.'
              : ' Automatic recalculation is off for this board.'}
          </Text>
        </View>
        {!showInput ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Acknowledge planning risk'
            onPress={() => setShowInput(true)}
            className='rounded-md border border-amber-300 bg-white px-3 py-1.5 active:opacity-70'
          >
            <Text className='text-xs font-medium text-amber-900'>Acknowledge</Text>
          </Pressable>
        ) : null}
      </View>
      {showInput ? (
        <View className='mt-2 gap-2'>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder='Reason for keeping the current dates...'
            placeholderTextColor='#92400E'
            className='rounded border border-amber-200 bg-white px-2 py-2 text-sm text-foreground'
            editable={!submitting}
            accessibilityLabel='Acknowledge planning risk reason'
          />
          <View className='flex-row justify-end gap-2'>
            <Pressable
              accessibilityRole='button'
              onPress={() => {
                setShowInput(false);
                setReason('');
              }}
              className='rounded-md px-3 py-1.5 active:opacity-70'
              disabled={submitting}
            >
              <Text className='text-xs font-medium text-amber-900'>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              onPress={() => void handleConfirm()}
              disabled={submitting || !reason.trim()}
              className='rounded-md px-3 py-1.5 active:opacity-70'
              style={{ backgroundColor: accentBg, opacity: submitting || !reason.trim() ? 0.5 : 1 }}
            >
              <Text className='text-xs font-semibold text-white'>
                {submitting ? 'Saving…' : 'Confirm'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
