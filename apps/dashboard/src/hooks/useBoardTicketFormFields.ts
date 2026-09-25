import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { formService, type BoardTicketFormField } from '../services/Form/formService';

/**
 * Fields on a board's ticket form.
 *
 * Prefer this over useGlobalFieldSearch anywhere the user is picking a field that a
 * ticket on a specific board must be able to supply: a board whose form predates
 * GlobalFields has no global field ids at all, so the project-wide GlobalField list
 * would offer keys its tickets can never carry.
 */
export const useBoardTicketFormFields = (
  boardId: string | null | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<BoardTicketFormField[]> => {
  const enabled = (options?.enabled ?? true) && Boolean(boardId);

  return useQuery({
    queryKey: ['board-ticket-form-fields', boardId],
    queryFn: () => {
      if (!boardId) {
        return Promise.resolve([]);
      }
      return formService.getBoardTicketFormFields({ boardId });
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};
