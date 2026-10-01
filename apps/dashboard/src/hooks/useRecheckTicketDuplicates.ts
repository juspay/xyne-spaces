import { useCallback, useState } from 'react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { recheckTicketDuplicates } from '../services/ticketDuplicateService';

interface UseRecheckTicketDuplicatesResult {
  isRechecking: boolean;
  recheck: () => void;
}

/**
 * Re-runs duplicate detection for a desk ticket. A match is linked server-side and
 * reaches DuplicateTicketsBanner through Zero, so this only reports the outcome.
 */
export const useRecheckTicketDuplicates = (
  ticketId: string | null | undefined,
): UseRecheckTicketDuplicatesResult => {
  const [isRechecking, setIsRechecking] = useState(false);

  const recheck = useCallback(() => {
    if (!ticketId || isRechecking) return;
    setIsRechecking(true);
    recheckTicketDuplicates(ticketId)
      .then(result => {
        if (result.isDuplicate) {
          toast.success('Possible duplicate found');
        } else {
          toast.info(
            result.candidateCount === 0 ? 'No similar tickets found' : 'No duplicates found',
          );
        }
      })
      .catch(error => {
        // 429: a check for this ticket is already running (another tab, agent, or the
        // banner and menu both clicked). Not a failure — that check will report.
        if (isAxiosError(error) && error.response?.status === 429) {
          toast.info('A duplicate check is already running for this ticket.');
          return;
        }
        toast.error('Duplicate check failed. Please try again.');
      })
      .finally(() => setIsRechecking(false));
  }, [ticketId, isRechecking]);

  return { isRechecking, recheck };
};
