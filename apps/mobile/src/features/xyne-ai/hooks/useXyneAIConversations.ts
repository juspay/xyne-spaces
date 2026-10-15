import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import {
  deleteConversation,
  fetchConversations,
  updateConversation,
  type ConversationPage,
  type ConversationPatch,
  type ConversationSummary,
} from '../api/xyneAIConversations';

const CONVERSATIONS_KEY = ['xyne-ai', 'conversations'];

export function useXyneAIConversations(): {
  list: UseInfiniteQueryResult<ConversationSummary[]>;
  update: UseMutationResult<
    unknown,
    Error,
    { conversation: ConversationSummary; patch: ConversationPatch }
  >;
  remove: UseMutationResult<unknown, Error, ConversationSummary>;
} {
  const queryClient = useQueryClient();
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });

  return {
    list: useInfiniteQuery({
      queryKey: CONVERSATIONS_KEY,
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchConversations(pageParam),
      initialPageParam: undefined,
      getNextPageParam: (page: ConversationPage) => page.nextCursor ?? undefined,
      select: ({ pages }) => pages.flatMap(page => page.data),
    }),
    update: useMutation({
      mutationFn: ({ conversation, patch }) => updateConversation(conversation, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: deleteConversation, onSuccess: refresh }),
  };
}
