import { useCallback } from 'react';
import { toast } from 'sonner';
import { mutators } from '../zero/mutators';
import { useZero } from './useZero';

export interface UsePinReturn {
  togglePin: (conversationId: string) => void;
  isPinning: boolean;
}

export const usePin = (): UsePinReturn => {
  const zero = useZero();

  const togglePin = useCallback(
    (conversationId: string): void => {
      try {
        zero.mutate(
          mutators.conversations.togglePin({
            conversationId,
          }),
        );
      } catch {
        toast.error('Failed to update', {
          description: 'Could not pin/unpin conversation',
          duration: 3000,
        });
      }
    },
    [zero],
  );

  return {
    togglePin,
    isPinning: false, // TODO: Add loading state if needed
  };
};
