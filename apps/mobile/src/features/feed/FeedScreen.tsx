import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, MessageCircle } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';
import { useOptionalTabPager } from '@/src/components/tab-pager/tab-pager-context';
import { useFlag, setFlag } from '@/src/flags';
import { getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';
import { feedRequest } from './api';
import { Button, Notice, Sheet } from './FeedUI';
import { PostCard } from './PostCard';
import { Composer } from './FeedComposer';
import { Comments } from './FeedComments';
import type { FeedPost, FeedPage } from './types';

function FeedContent({ workspaceId }: { workspaceId: string }): ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; messageId?: string }>();
  const [mine, setMine] = useState(false);
  const [compose, setCompose] = useState(!!params.conversationId);
  const [editing, setEditing] = useState<FeedPost | undefined>();
  const [commentPost, setCommentPost] = useState<string | null>(null);
  const focused = useTabPageIsFocused();
  const client = useQueryClient();
  const color = useCSSVariable('--color-foreground') as string;
  const surface = useCSSVariable('--color-card') as string;
  const { accentBg, accentFg, accentText } = useBubbleAccent();
  const inTab = useOptionalTabPager() !== null;
  const query = useInfiniteQuery({
    queryKey: ['feed', workspaceId, 'posts', mine],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      feedRequest<FeedPage>(
        workspaceId,
        `/posts?mine=${mine}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: focused && !compose && !commentPost ? 10000 : false,
    retry: false,
  });
  useReportTabReady('feed', !query.isPending);
  useFocusEffect(
    useCallback((): void => {
      void client.invalidateQueries({ queryKey: ['feed', workspaceId] });
    }, [client, workspaceId]),
  );
  const metadata = query.data?.pages[0];
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['feed', workspaceId] });
  };
  const closeComposer = (): void => {
    setCompose(false);
    setEditing(undefined);
    router.setParams({ conversationId: '', messageId: '' });
  };
  const detail = useQuery({
    queryKey: ['feed', workspaceId, 'post', commentPost],
    enabled: !!commentPost,
    queryFn: ({ signal }) =>
      feedRequest<{ post: FeedPost; viewerId: string; canModerate: boolean }>(
        workspaceId,
        `/posts/${commentPost}`,
        { signal },
      ),
    retry: false,
  });
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: surface }}
      edges={inTab ? ['top'] : ['top', 'bottom']}
    >
      <View className='flex-row items-center gap-3 bg-card px-4 py-3'>
        {!inTab ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Back'
            onPress={() => router.back()}
            className='p-2'
          >
            <ArrowLeft size={23} color={color} />
          </Pressable>
        ) : null}
        <View className='flex-1'>
          <Text className='text-xl font-bold text-foreground'>Feed</Text>
          <Text className='text-xs text-secondary-foreground'>
            {metadata?.workspaceName ?? 'Your workspace'}
          </Text>
        </View>
      </View>
      <View className='flex-row border-b border-border bg-card px-4'>
        {[false, true].map(value => (
          <Pressable
            key={String(value)}
            accessibilityRole='tab'
            accessibilityState={{ selected: mine === value }}
            onPress={() => setMine(value)}
            className='flex-1 items-center py-3'
          >
            <Text
              className={
                mine === value
                  ? 'font-bold text-foreground'
                  : 'font-medium text-secondary-foreground'
              }
            >
              {value ? 'My posts' : 'Workspace'}
            </Text>
            {mine === value ? (
              <View
                style={{ backgroundColor: accentBg }}
                className='absolute bottom-0 h-1 w-14 rounded-full'
              />
            ) : null}
          </Pressable>
        ))}
      </View>
      <FlatList
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 96 }}
        data={query.data?.pages.flatMap(page => page.posts) ?? []}
        keyExtractor={post => post.id}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => {
          void query.refetch();
        }}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          query.isPending ? (
            <ActivityIndicator style={{ padding: 40 }} />
          ) : query.isError ? (
            <Notice
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          ) : (
            <View className='items-center gap-4 px-8 py-12'>
              <View className='mb-2 h-20 w-20 items-center justify-center rounded-3xl bg-secondary'>
                <MessageCircle size={32} color={accentText} strokeWidth={1.5} />
              </View>
              <Text className='text-xs font-bold uppercase tracking-widest text-secondary-foreground'>
                Your community, connected
              </Text>
              <Text className='text-center text-2xl font-bold tracking-tight text-foreground'>
                Good conversations start here.
              </Text>
              <Text className='text-center leading-6 text-secondary-foreground'>
                A fresh idea, a small win, a conversation worth sharing. Make it the start of
                something.
              </Text>
              <Button onPress={() => setCompose(true)}>Create the first post</Button>
            </View>
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator style={{ padding: 20 }} />
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
          <PostCard
            post={item}
            workspaceId={workspaceId}
            viewerId={metadata?.viewerId ?? ''}
            canModerate={metadata?.canModerate ?? false}
            onComments={() => setCommentPost(item.id)}
            onEdit={() => {
              setEditing(item);
              setCompose(true);
            }}
            refresh={refresh}
          />
        )}
      />
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Create a post'
        onPress={() => setCompose(true)}
        className='absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full'
        style={{
          backgroundColor: accentBg,
          elevation: 5,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        <Plus size={28} color={accentFg} />
      </Pressable>
      {compose ? (
        <Composer
          workspaceId={workspaceId}
          workspaceName={metadata?.workspaceName ?? 'your workspace'}
          {...(params.conversationId ? { conversationId: params.conversationId } : {})}
          {...(params.messageId ? { selectedMessageId: params.messageId } : {})}
          {...(editing ? { editing } : {})}
          onClose={closeComposer}
          onPublished={() => {
            closeComposer();
            setMine(false);
            refresh();
          }}
        />
      ) : null}
      {commentPost ? (
        detail.isError ? (
          <Sheet title='Comments' onClose={() => setCommentPost(null)}>
            <Notice
              error={detail.error}
              retry={() => {
                void detail.refetch();
              }}
            />
          </Sheet>
        ) : (
          <Comments
            postId={commentPost}
            post={detail.data?.post}
            onEditPost={() => {
              setCommentPost(null);
              setEditing(detail.data?.post);
              setCompose(true);
            }}
            workspaceId={workspaceId}
            viewerId={metadata?.viewerId ?? ''}
            canModerate={metadata?.canModerate ?? false}
            onClose={() => {
              setCommentPost(null);
              refresh();
            }}
          />
        )
      ) : null}
    </SafeAreaView>
  );
}
export default function FeedScreen(): ReactElement {
  const { user } = useAuth();
  const enabled = useFlag('feed.prototype');
  const router = useRouter();
  if (!enabled)
    return (
      <SafeAreaView className='flex-1 justify-center gap-5 bg-background p-8'>
        <Text className='text-3xl font-bold text-foreground'>Workspace Feed</Text>
        <Text className='leading-6 text-secondary-foreground'>
          Try the feed preview with real posts and conversations. Published content is visible to
          everyone in your workspace.
        </Text>
        <Button onPress={() => setFlag('feed.prototype', true)}>Enable on this device</Button>
        <Button onPress={() => router.back()}>Back</Button>
      </SafeAreaView>
    );
  if (!user?.workspaceId)
    return (
      <SafeAreaView className='flex-1 bg-background p-8'>
        <Text className='text-foreground'>Select a workspace to open Feed.</Text>
      </SafeAreaView>
    );
  return (
    <FeedContent
      key={`${user.user_id}:${user.workspaceId}:${getAuthSessionGeneration()}`}
      workspaceId={user.workspaceId}
    />
  );
}
