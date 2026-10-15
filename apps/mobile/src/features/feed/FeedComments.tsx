import { useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, MessageCircle } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { v4 as uuid } from 'uuid';
import { feedRequest, feedError } from './api';
import { Avatar, Notice, Sheet } from './FeedUI';
import type { FeedComment } from './types';
export function Comments({
  postId,
  workspaceId,
  viewerId,
  canModerate,
  onClose,
}: {
  postId: string;
  workspaceId: string;
  viewerId: string;
  canModerate: boolean;
  onClose: () => void;
}): ReactElement {
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const request = useRef(uuid());
  const color = useCSSVariable('--color-secondary-foreground') as string;
  const query = useInfiniteQuery({
    queryKey: ['feed', workspaceId, 'comments', postId],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      feedRequest<{ comments: FeedComment[]; nextCursor: string | null }>(
        workspaceId,
        `/posts/${postId}/comments${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: 10000,
    retry: false,
  });
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['feed', workspaceId] });
  };
  const send = useMutation({
    mutationFn: () =>
      feedRequest(workspaceId, `/posts/${postId}/comments${editing ? `/${editing}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: { body, requestId: request.current },
      }),
    onSuccess: () => {
      setBody('');
      setEditing(null);
      request.current = uuid();
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (commentId: string) =>
      feedRequest(workspaceId, `/posts/${postId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: error => Alert.alert('Could not delete comment', feedError(error)),
  });
  return (
    <Sheet title='Comments' onClose={onClose}>
      <FlatList
        data={query.data?.pages.flatMap(page => page.comments) ?? []}
        keyExtractor={comment => comment.id}
        contentContainerStyle={{ padding: 20, gap: 20 }}
        ListEmptyComponent={
          query.isPending ? (
            <ActivityIndicator />
          ) : query.isError ? (
            <Notice
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          ) : (
            <View className='items-center gap-3 py-16'>
              <View className='h-16 w-16 items-center justify-center rounded-full bg-secondary'>
                <MessageCircle size={28} color={color} strokeWidth={1.5} />
              </View>
              <Text className='text-lg font-bold text-foreground'>Be the first to join in</Text>
              <Text className='text-center text-sm leading-5 text-secondary-foreground'>
                A thoughtful reply can start a great conversation.
              </Text>
            </View>
          )
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator />
          ) : query.isError && query.data ? (
            <Notice
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <View className='flex-row gap-3'>
            <Avatar name={item.authorName} />
            <View className='flex-1'>
              <Text className='font-semibold text-foreground'>{item.authorName}</Text>
              <Text className='mt-1 leading-6 text-foreground'>{item.body}</Text>
              <View className='mt-2 flex-row gap-5'>
                {item.authorId === viewerId ? (
                  <Pressable
                    accessibilityRole='button'
                    onPress={() => {
                      setEditing(item.id);
                      setBody(item.body);
                    }}
                  >
                    <Text className='text-secondary-foreground'>Edit</Text>
                  </Pressable>
                ) : null}
                {item.authorId === viewerId || canModerate ? (
                  <Pressable
                    accessibilityRole='button'
                    disabled={remove.isPending}
                    onPress={() =>
                      Alert.alert('Delete comment?', undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => remove.mutate(item.id),
                        },
                      ])
                    }
                  >
                    <Text className='text-secondary-foreground'>Delete</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        )}
      />
      <View className='gap-3 border-t border-border p-4'>
        {editing ? (
          <Pressable
            accessibilityRole='button'
            onPress={() => {
              setEditing(null);
              setBody('');
            }}
          >
            <Text className='text-secondary-foreground'>Editing comment · Cancel</Text>
          </Pressable>
        ) : null}
        {send.isError ? <Text className='text-red-500'>{feedError(send.error)}</Text> : null}
        <View className='flex-row items-end gap-3'>
          <TextInput
            accessibilityLabel='Comment'
            placeholder='Add to the conversation…'
            placeholderTextColor={color}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={2000}
            className='max-h-32 min-h-12 flex-1 rounded-2xl bg-secondary px-4 py-3 text-base text-foreground'
          />
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={editing ? 'Save comment' : 'Send comment'}
            disabled={!body.trim() || send.isPending}
            onPress={() => send.mutate()}
            className='h-12 w-12 items-center justify-center rounded-full bg-brand'
            style={{ opacity: !body.trim() || send.isPending ? 0.4 : 1 }}
          >
            {send.isPending ? (
              <ActivityIndicator color='#171d29' />
            ) : (
              <ArrowUp size={22} color='#171d29' />
            )}
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}
