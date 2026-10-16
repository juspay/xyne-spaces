import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { FeedAuthor } from './FeedAuthor';
import { useState, type ReactElement } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Heart, MessageCircle, MoreHorizontal, MessagesSquare } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { feedRequest, feedError } from './api';
import { FeedMediaStrip } from './FeedMedia';
import { feedTime } from './FeedUI';
import type { FeedPost } from './types';
export function PostCard({
  post,
  workspaceId,
  viewerId,
  canModerate,
  onComments,
  onEdit,
  refresh,
  onNavigate,
}: {
  post: FeedPost;
  workspaceId: string;
  viewerId: string;
  canModerate: boolean;
  onComments: () => void;
  onEdit: () => void;
  refresh: () => void;
  onNavigate?: (() => void) | undefined;
}): ReactElement {
  const { accentText } = useBubbleAccent();
  const color = useCSSVariable('--color-secondary-foreground') as string;
  const [expanded, setExpanded] = useState(false);
  const like = useMutation({
    mutationFn: () =>
      feedRequest(workspaceId, `/posts/${post.id}/like`, {
        method: 'PUT',
        body: { liked: !post.liked },
      }),
    onSuccess: refresh,
    onError: error => Alert.alert('Could not update like', feedError(error)),
  });
  const remove = useMutation({
    mutationFn: () => feedRequest(workspaceId, `/posts/${post.id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: error => Alert.alert('Could not remove post', feedError(error)),
  });
  const report = useMutation({
    mutationFn: () =>
      feedRequest(workspaceId, `/posts/${post.id}/report`, {
        method: 'POST',
        body: { reason: 'Reported from mobile: inappropriate or sensitive content' },
      }),
    onSuccess: () =>
      Alert.alert('Report submitted', 'Your workspace administrators can review this post.'),
    onError: error => Alert.alert('Could not report', feedError(error)),
  });
  const menu = (): void =>
    Alert.alert('Post options', undefined, [
      ...(post.authorId === viewerId ? [{ text: 'Edit commentary', onPress: onEdit }] : []),
      ...(post.authorId === viewerId || canModerate
        ? [
            {
              text: 'Delete post',
              style: 'destructive' as const,
              onPress: () =>
                Alert.alert(
                  'Delete this post?',
                  'Its published media and discussion will no longer be available in Feed.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
                  ],
                ),
            },
          ]
        : []),
      { text: 'Report post', onPress: () => report.mutate() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  return (
    <View className='flex-row gap-3 border-b border-border bg-card px-4 pt-3'>
      <FeedAuthor userId={post.authorId} name={post.authorName} avatar onNavigate={onNavigate} />
      <View className='min-w-0 flex-1'>
        <View className='mb-1 flex-row items-center gap-1'>
          <FeedAuthor userId={post.authorId} name={post.authorName} onNavigate={onNavigate} />
          <Text className='text-[13px] text-secondary-foreground'>
            · {feedTime(post.createdAt)}
          </Text>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Post options'
            disabled={remove.isPending || report.isPending}
            onPress={menu}
            hitSlop={8}
            className='ml-auto h-8 w-8 items-center justify-center'
          >
            <MoreHorizontal size={20} color={color} />
          </Pressable>
        </View>
        {post.updatedAt !== post.createdAt ? (
          <Text className='mb-2 text-xs text-secondary-foreground'>Edited</Text>
        ) : null}
        <FeedMediaStrip media={post.excerpts[0]?.media ?? []} workspaceId={workspaceId} />
        {post.body ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Expand post'
            onPress={() => setExpanded(value => !value)}
          >
            <Text
              className='mb-2 text-[15px] leading-[22px] text-foreground'
              numberOfLines={expanded ? undefined : 6}
            >
              {post.body}
            </Text>
            {!expanded && post.body.length > 300 ? (
              <Text style={{ color: accentText }} className='mb-2 text-[15px]'>
                Show more
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {post.excerpts.length ? (
          <View className='mt-1 gap-3 rounded-2xl border border-border p-3'>
            <View className='flex-row items-center gap-2'>
              <MessagesSquare size={14} color={color} />
              <Text className='text-xs text-secondary-foreground'>Shared conversation</Text>
            </View>
            {post.excerpts.map((excerpt, index) => (
              <View key={`${excerpt.author.id}-${excerpt.createdAt}-${index}`}>
                {index > 0 ? (
                  <FeedMediaStrip media={excerpt.media} workspaceId={workspaceId} />
                ) : null}
                <FeedAuthor
                  userId={excerpt.author.id}
                  name={excerpt.author.name}
                  onNavigate={onNavigate}
                />
                <Text
                  className='text-[15px] leading-[22px] text-foreground'
                  numberOfLines={expanded ? undefined : 5}
                >
                  {excerpt.text}
                </Text>
              </View>
            ))}
            {post.excerpts.some(
              excerpt => excerpt.text.length > 220 || excerpt.text.split('\n').length > 5,
            ) ? (
              <Pressable
                accessibilityRole='button'
                onPress={() => setExpanded(value => !value)}
                className='min-h-11 justify-center'
              >
                <Text style={{ color: accentText }} className='text-sm'>
                  {expanded ? 'Show less' : 'Read full excerpt'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View className='mt-1 flex-row items-center'>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Open comments'
            onPress={onComments}
            className='min-h-11 flex-1 flex-row items-center gap-2'
          >
            <MessageCircle size={19} strokeWidth={1.7} color={color} />
            <Text className='text-xs text-secondary-foreground'>{post.commentCount || ''}</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={post.liked ? 'Unlike post' : 'Like post'}
            accessibilityState={{ selected: post.liked }}
            disabled={like.isPending}
            onPress={() => like.mutate()}
            className='min-h-11 flex-1 flex-row items-center gap-2'
          >
            <Heart
              size={19}
              strokeWidth={1.7}
              color={post.liked ? accentText : color}
              fill={post.liked ? accentText : 'transparent'}
            />
            <Text style={{ color: post.liked ? accentText : color }} className='text-xs'>
              {post.likeCount || ''}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Reply to post'
            onPress={onComments}
            className='min-h-11 justify-center'
          >
            <Text style={{ color: accentText }} className='text-xs font-medium'>
              Reply
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
