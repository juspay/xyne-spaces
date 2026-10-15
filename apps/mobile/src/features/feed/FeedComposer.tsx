import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useCSSVariable } from 'uniwind';
import { v4 as uuid } from 'uuid';
import { feedRequest, feedError } from './api';
import { FeedMediaStrip } from './FeedMedia';
import { Button, Notice, Sheet } from './FeedUI';
import type { FeedPost, SourcePage, SourceMessage } from './types';
export function Composer({
  workspaceId,
  workspaceName,
  conversationId,
  selectedMessageId,
  editing,
  onClose,
  onPublished,
}: {
  workspaceId: string;
  workspaceName: string;
  conversationId?: string;
  selectedMessageId?: string;
  editing?: FeedPost;
  onClose: () => void;
  onPublished: () => void;
}): ReactElement {
  const { accentText } = useBubbleAccent();
  const [body, setBody] = useState(editing?.body ?? '');
  const [selected, setSelected] = useState<SourceMessage[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState(!conversationId);
  const request = useRef(uuid());
  const color = useCSSVariable('--color-secondary-foreground') as string;
  const source = useInfiniteQuery({
    queryKey: ['feed', workspaceId, 'source', conversationId, selectedMessageId],
    enabled: !!conversationId,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      feedRequest<SourcePage>(
        workspaceId,
        `/source/${encodeURIComponent(conversationId ?? '')}?${new URLSearchParams({ ...(pageParam ? { after: pageParam } : {}), ...(selectedMessageId ? { selected: selectedMessageId } : {}) }).toString()}`,
        { signal },
      ),
    getNextPageParam: page => page.nextCursor ?? undefined,
    retry: false,
  });
  const messages = [
    ...new Map(
      (source.data?.pages.flatMap(page => page.messages) ?? []).map(message => [
        message.id,
        message,
      ]),
    ).values(),
  ];
  const initial = messages.find(message => message.id === selectedMessageId);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const selection = selectionTouched ? selected : initial ? [initial] : [];
  const toggle = (message: SourceMessage): void => {
    setSelectionTouched(true);
    const exists = selection.some(item => item.id === message.id);
    if (!exists && selection.length >= 10) {
      Alert.alert('Up to 10 messages', 'Remove a message before adding another.');
      return;
    }
    setSelected(
      exists
        ? selection.filter(item => item.id !== message.id)
        : [...selection, message].sort(
            (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
          ),
    );
    setConfirmed(false);
  };
  const publish = useMutation({
    mutationFn: () =>
      feedRequest(workspaceId, editing ? `/posts/${editing.id}` : '/posts', {
        method: editing ? 'PATCH' : 'POST',
        timeoutMs: 180000,
        body: editing
          ? { body }
          : {
              body,
              requestId: request.current,
              conversationId: conversationId ?? null,
              messageIds: selection.map(message => message.id),
              revisions: Object.fromEntries(
                selection.map(message => [message.id, message.revision]),
              ),
              confirmWorkspacePublication: confirmed,
            },
      }),
    onSuccess: onPublished,
  });
  const close = (): void => {
    if (publish.isPending) return;
    if (body.trim() !== (editing?.body ?? '').trim() || selectionTouched)
      Alert.alert('Discard this draft?', undefined, [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ]);
    else onClose();
  };
  const publishButton = (
    <Button
      disabled={
        publish.isPending ||
        (!body.trim() && !selection.length && !editing?.excerpts.length) ||
        (!editing && !confirmed)
      }
      onPress={() => publish.mutate()}
    >
      {publish.isPending ? 'Publishing media…' : editing ? 'Save changes' : 'Publish post'}
    </Button>
  );
  return (
    <Sheet
      title={editing ? 'Edit post' : review ? 'New post' : 'Choose messages'}
      onClose={close}
      action={review ? publishButton : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{ padding: 20, gap: 16 }}
      >
        <Text
          style={{ color: accentText, borderColor: accentText }}
          className='self-start rounded-full border px-3 py-1 text-xs font-bold'
        >
          Sharing with everyone in {source.data?.pages[0]?.workspaceName ?? workspaceName}
        </Text>
        {conversationId && !review ? (
          <>
            <Text className='text-secondary-foreground'>
              Select up to 10 messages. Their images, videos, audio and files will be included.
            </Text>
            {source.isPending ? (
              <ActivityIndicator />
            ) : source.isError ? (
              <Notice
                error={source.error}
                retry={() => {
                  void source.refetch();
                }}
              />
            ) : (
              messages.map(message => (
                <Pressable
                  key={message.id}
                  accessibilityRole='checkbox'
                  accessibilityState={{ checked: selection.some(item => item.id === message.id) }}
                  onPress={() => toggle(message)}
                  className='rounded-2xl border border-border p-4'
                  style={{ borderWidth: selection.some(item => item.id === message.id) ? 2 : 1 }}
                >
                  <Text className='mb-2 font-semibold text-foreground'>
                    {selection.some(item => item.id === message.id) ? '✓ ' : ''}
                    {message.author.name}
                  </Text>
                  <Text className='text-foreground' numberOfLines={4}>
                    {message.text || 'Media message'}
                  </Text>
                  {message.media.length ? (
                    <Text className='mt-2 text-secondary-foreground'>
                      {message.media.length} attachments
                    </Text>
                  ) : null}
                </Pressable>
              ))
            )}
            {source.hasNextPage ? (
              <Button
                disabled={source.isFetchingNextPage}
                onPress={() => {
                  void source.fetchNextPage();
                }}
              >
                Load more messages
              </Button>
            ) : null}
            <Button
              disabled={!selection.length}
              onPress={() => {
                setSelected(selection);
                setSelectionTouched(true);
                setReview(true);
              }}
            >
              Preview {selection.length} messages
            </Button>
          </>
        ) : (
          <>
            {selection.map(message => (
              <View key={message.id} className='rounded-2xl border border-border p-3'>
                <FeedMediaStrip media={message.media} workspaceId={workspaceId} source />
                <Text className='font-semibold text-foreground'>{message.author.name}</Text>
                <Text className='mt-2 text-foreground'>{message.text}</Text>
              </View>
            ))}
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder='What’s happening?'
              placeholderTextColor={color}
              multiline
              maxLength={5000}
              textAlignVertical='top'
              className='min-h-40 text-xl leading-7 text-foreground'
              accessibilityLabel='Post commentary'
            />
            {conversationId ? (
              <Button
                disabled={publish.isPending}
                onPress={() => {
                  setReview(false);
                  setConfirmed(false);
                }}
              >
                Change selection
              </Button>
            ) : null}
            {!editing ? (
              <Pressable
                accessibilityRole='checkbox'
                accessibilityState={{ checked: confirmed }}
                onPress={() => setConfirmed(value => !value)}
                className='rounded-2xl border border-border bg-secondary p-4'
              >
                <Text className='text-sm leading-5 text-secondary-foreground'>
                  {confirmed ? '✓ ' : '○ '}
                  {conversationId
                    ? 'These messages and their media will be visible to everyone in this workspace, including people who cannot access the original conversation. Published copies remain if the original messages are deleted.'
                    : 'This post will be visible to everyone in this workspace.'}
                </Text>
                <Text className='mt-2 font-semibold text-foreground'>
                  I understand and want to publish
                </Text>
              </Pressable>
            ) : null}
            {publish.isError ? (
              <Text accessibilityRole='alert' className='text-red-500'>
                {feedError(publish.error)}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
