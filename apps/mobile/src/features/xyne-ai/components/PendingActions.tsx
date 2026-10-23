import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Check, Shield, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';

import type { PendingAction } from '../api/xyneAIEvents';

// `server__tool-name` and `ns:tool_name` read as "Tool Name".
const toolLabel = (tool: string): string =>
  (tool.split('__').slice(1).join('__') || tool)
    .split(':')
    .at(-1)!
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const PendingActionCard = ({
  action,
  onRespond,
}: {
  action: PendingAction;
  onRespond: (action: PendingAction, approved: boolean) => Promise<void>;
}): ReactElement => {
  const decision = action.resolution;
  const [isSending, setIsSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const muted = useCSSVariable('--color-secondary-foreground') as string;

  const respond = (approved: boolean): void => {
    void haptics.buttonTap();
    setIsSending(true);
    setFailed(false);
    // On success the turn records the decision, which replaces the buttons.
    onRespond(action, approved)
      .catch((): void => setFailed(true))
      .finally((): void => setIsSending(false));
  };

  if (decision) {
    return (
      <View className='flex-row items-center gap-2'>
        {decision === 'approved' ? (
          <Check size={14} color={muted} />
        ) : (
          <X size={14} color={muted} />
        )}
        <Text className='text-[13px] text-secondary-foreground'>
          {toolLabel(action.tool)} {decision}
        </Text>
      </View>
    );
  }

  return (
    <View className='gap-2 rounded-xl border border-border p-3'>
      <View className='flex-row items-center gap-2'>
        <Shield size={14} color={muted} />
        <Text className='min-w-0 flex-1 text-[14px] text-foreground'>
          The agent wants to <Text className='font-medium'>{toolLabel(action.tool)}</Text>
        </Text>
      </View>
      <Text
        numberOfLines={8}
        className='rounded-lg bg-secondary p-2 font-mono text-[11px] text-secondary-foreground'
      >
        {JSON.stringify(action.params, null, 2)}
      </Text>
      {failed ? (
        <Text className='text-[13px] text-settings-icon-red'>
          Could not send your answer. Try again.
        </Text>
      ) : null}
      <View className='flex-row gap-2'>
        <Pressable
          accessibilityRole='button'
          disabled={isSending}
          onPress={(): void => respond(true)}
          className='min-h-[40px] flex-1 items-center justify-center rounded-lg bg-brand active:opacity-70'
        >
          {isSending ? (
            <ActivityIndicator size='small' color='#fff' />
          ) : (
            <Text className='text-[14px] font-medium text-white'>Approve</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole='button'
          disabled={isSending}
          onPress={(): void => respond(false)}
          className='min-h-[40px] flex-1 items-center justify-center rounded-lg bg-secondary active:opacity-70'
        >
          <Text className='text-[14px] font-medium text-foreground'>Decline</Text>
        </Pressable>
      </View>
    </View>
  );
};

export const PendingActions = ({
  actions,
  onRespond,
}: {
  actions: PendingAction[];
  onRespond: (action: PendingAction, approved: boolean) => Promise<void>;
}): ReactElement => (
  <View className='gap-2'>
    {actions.map(action => (
      <PendingActionCard key={action.id} action={action} onRespond={onRespond} />
    ))}
  </View>
);
