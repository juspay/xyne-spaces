import { useState, type ReactElement } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { formatDistanceToNowStrict } from 'date-fns';
import { useMutation } from '@tanstack/react-query';
import { Heart, MessageCircle, MoreHorizontal, MessagesSquare } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { feedRequest, feedError } from './api';
import { FeedMediaStrip } from './FeedMedia';
import { Avatar } from './FeedUI';
import type { FeedPost } from './types';
export function PostCard({
  post,
  workspaceId,
  viewerId,
  canModerate,
  onComments,
  onEdit,
  refresh,
}: {
  post: FeedPost;
  workspaceId: string;
  viewerId: string;
  canModerate: boolean;
  onComments: () => void;
  onEdit: () => void;
  refresh: () => void;
}): ReactElement {
  const color = useCSSVariable('--color-foreground') as string;
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
    <View className='border-b border-border bg-card py-4'>
      <View className='mb-3 flex-row items-center gap-3 px-4'>
        <Avatar name={post.authorName} />
        <View className='flex-1'>
          <Text className='font-bold text-foreground'>{post.authorName}</Text>
          <Text className='mt-1 text-xs text-secondary-foreground'>
            {formatDistanceToNowStrict(new Date(post.createdAt), { addSuffix: true })}{' '}
            {post.updatedAt !== post.createdAt ? '· Edited' : ''}
          </Text>
        </View>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Post options'
          disabled={remove.isPending || report.isPending}
          onPress={menu}
          className='p-2'
        >
          <MoreHorizontal size={22} color={color} />
        </Pressable>
      </View>
      <FeedMediaStrip media={post.excerpts[0]?.media ?? []} workspaceId={workspaceId} />
      <View className='px-4'>
        {post.body ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Expand post'
            onPress={() => setExpanded(value => !value)}
          >
            <Text
              className='mb-3 text-[15px] leading-[22px] text-foreground'
              numberOfLines={expanded ? undefined : 6}
            >
              {post.body}
            </Text>
            {!expanded && post.body.length > 300 ? (
              <Text className='mb-3 text-secondary-foreground'>Show more</Text>
            ) : null}
          </Pressable>
        ) : null}
        {post.excerpts.length ? (
          <View className='mb-2 gap-3 rounded-2xl border border-border bg-secondary p-4'>
            <View className='flex-row items-center gap-2'>
              <MessagesSquare size={14} color={color} />
              <Text className='text-xs font-medium text-secondary-foreground'>
                From a conversation
              </Text>
            </View>
            {post.excerpts.map((excerpt, index) => (
              <View key={`${excerpt.author.id}-${excerpt.createdAt}-${index}`}>
                {index > 0 ? (
                  <FeedMediaStrip media={excerpt.media} workspaceId={workspaceId} />
                ) : null}
                <Text className='mb-1 font-semibold text-foreground'>{excerpt.author.name}</Text>
                <Text
                  className='text-[15px] leading-6 text-foreground'
                  numberOfLines={
                    expanded || (excerpt.text.length <= 220 && excerpt.text.split('\n').length <= 5)
                      ? undefined
                      : 5
                  }
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
                <Text className='text-sm font-medium text-secondary-foreground'>
                  {expanded ? 'Show less' : 'Read full excerpt'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View className='mt-1 flex-row items-center gap-6'>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={post.liked ? 'Unlike post' : 'Like post'}
            accessibilityState={{ selected: post.liked }}
            disabled={like.isPending}
            onPress={() => like.mutate()}
            className='min-h-11 flex-row items-center gap-2'
          >
            <Heart
              size={23}
              color={post.liked ? '#e14865' : color}
              fill={post.liked ? '#e14865' : 'transparent'}
            />
            <Text className='text-foreground'>{post.likeCount || ''}</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Open comments'
            onPress={onComments}
            className='min-h-11 flex-row items-center gap-2'
          >
            <MessageCircle size={23} color={color} />
            <Text className='text-foreground'>{post.commentCount || ''}</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole='button' onPress={onComments} className='pb-1 pt-1'>
          <Text className='text-sm text-secondary-foreground'>
            {post.commentCount
              ? `View ${post.commentCount === 1 ? 'the comment' : `all ${post.commentCount} comments`}`
              : 'Start a conversation…'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
