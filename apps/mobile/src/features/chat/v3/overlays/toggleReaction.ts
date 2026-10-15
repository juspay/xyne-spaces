import { mutators } from '@/src/zero/mutators';

type ReactMutator = ReturnType<typeof mutators.messages.react>;

type MutateZero = {
  mutate: (payload: ReactMutator) => unknown;
};

/** Same mutate as the actions sheet / reactions host. No UI. */
export const toggleReaction = (
  zero: MutateZero,
  input: {
    messageId: string;
    emojiName: string;
    hasReacted: boolean;
    createId: () => string;
    now?: number;
  },
): void => {
  const timestamp = input.now ?? Date.now();
  void zero.mutate(
    mutators.messages.react({
      messageId: input.messageId,
      emojiName: input.emojiName,
      action: input.hasReacted ? 'remove' : 'add',
      timestamp,
      reactionId: input.hasReacted ? undefined : input.createId(),
      countId: input.hasReacted ? undefined : input.createId(),
    }),
  );
};
