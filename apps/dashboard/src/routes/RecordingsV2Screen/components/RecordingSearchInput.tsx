import * as Popover from '@radix-ui/react-popover';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { LexicalSearchInput } from '../../../components/Chat/ChatDirectory/LexicalSearchInput';
import { ChipType } from '../../../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { useActiveUserSearch } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import { slugifyRecordingLabel } from '../../../utils/recordingUtils';
import { getUserDisplayName } from '../../../utils/userDisplayName';

const OWNER_SUGGESTION_LIMIT = 8;
const LABEL_SUGGESTION_LIMIT = 8;

type InsertMention = (item: { id: string; name: string; email?: string }) => void;

export interface RecordingLabelOption {
  /** The label slug — what recordings are filtered on. */
  id: string;
  name: string;
}

interface RecordingSearchInputProps {
  /** Free text (matched against title and transcript), `@owner` ids and `#label` slugs. */
  onChange: (text: string, ownerIds: string[], labels: string[]) => void;
  /** Labels the viewer has seen on their recordings, suggested after `#`. */
  labelOptions: RecordingLabelOption[];
  isMobile: boolean;
  currentUserId?: string;
}

/**
 * Recordings search box: free text, `@person` chips that filter by owner and `#label` chips
 * that filter by label. `#` rides the input's channel trigger, so a label lands as a
 * CHANNEL-typed chip whose id is the label slug.
 */
export function RecordingSearchInput({
  onChange,
  labelOptions,
  isMobile,
  currentUserId,
}: RecordingSearchInputProps): ReactElement {
  const [ownerQuery, setOwnerQuery] = useState<string | null>(null);
  const [labelQuery, setLabelQuery] = useState<string | null>(null);
  const [selectedOwnerIds, setSelectedOwnerIds] = useState<string[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasNavigated, setHasNavigated] = useState(false);
  const insertMentionRef = useRef<InsertMention | null>(null);

  const userResults = useActiveUserSearch(ownerQuery ?? '', OWNER_SUGGESTION_LIMIT);
  const ownerSuggestions = useMemo(() => {
    if (ownerQuery === null) return [];
    const selected = new Set(selectedOwnerIds);
    return userResults
      .filter(candidate => !selected.has(candidate.id))
      .slice(0, OWNER_SUGGESTION_LIMIT);
  }, [ownerQuery, selectedOwnerIds, userResults]);

  const labelSuggestions = useMemo((): RecordingLabelOption[] => {
    if (labelQuery === null) return [];
    const selected = new Set(selectedLabels);
    const needle = labelQuery.trim().toLowerCase();
    const matches = labelOptions
      .filter(option => !selected.has(option.id) && option.name.toLowerCase().includes(needle))
      .slice(0, LABEL_SUGGESTION_LIMIT);
    // The suggestions only know labels on recordings loaded so far, so the typed text is
    // always offered too — the filter itself runs over every recording.
    const typed = slugifyRecordingLabel(labelQuery);
    return typed && !selected.has(typed) && !matches.some(option => option.id === typed)
      ? [...matches, { id: typed, name: typed }]
      : matches;
  }, [labelQuery, labelOptions, selectedLabels]);

  const closeSuggestions = useCallback((): void => {
    setOwnerQuery(null);
    setLabelQuery(null);
    setSelectedIndex(0);
    setHasNavigated(false);
  }, []);

  const handleUserSearch = useCallback((query: string | null): void => {
    setOwnerQuery(query);
    setSelectedIndex(0);
    setHasNavigated(false);
  }, []);

  const handleLabelSearch = useCallback((query: string | null): void => {
    setLabelQuery(query);
    setSelectedIndex(0);
    setHasNavigated(false);
  }, []);

  const handleChange = useCallback(
    (text: string, mentions: Array<{ id: string; type: ChipType }>): void => {
      const ownerIds = mentions
        .filter(mention => mention.type === ChipType.USER)
        .map(mention => mention.id);
      const labels = mentions
        .filter(mention => mention.type === ChipType.CHANNEL)
        .map(mention => mention.id);
      setSelectedOwnerIds(ownerIds);
      setSelectedLabels(labels);
      // An `@name` or `#label` still being typed is a lookup, not search text.
      onChange(text.replace(/(^|\s)[@#]\S*$/, '$1'), ownerIds, labels);
    },
    [onChange],
  );

  const mentionSearchType =
    ownerQuery !== null ? ChipType.USER : labelQuery !== null ? ChipType.CHANNEL : null;
  const hasChips = selectedOwnerIds.length > 0 || selectedLabels.length > 0;

  const suggestionClassName = (index: number): string =>
    cn(
      'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
      !isMobile && 'hover:bg-accent hover:text-accent-foreground',
      index === selectedIndex && hasNavigated && 'bg-accent text-accent-foreground',
    );
  const highlight = (index: number): void => {
    setSelectedIndex(index);
    setHasNavigated(true);
  };

  return (
    <Popover.Root open={mentionSearchType !== null} modal={false}>
      <Popover.Anchor asChild>
        <div className='relative w-full'>
          <LexicalSearchInput
            placeholder={hasChips ? '' : 'Search title, transcript, @owner, #label'}
            onChange={handleChange}
            onUserSearch={handleUserSearch}
            onChannelSearch={handleLabelSearch}
            availableUsers={ownerSuggestions.map(candidate => ({
              id: candidate.id,
              name: getUserDisplayName(candidate),
              ...(candidate.email ? { email: candidate.email } : {}),
            }))}
            availableChannels={labelSuggestions}
            mentionSearchType={mentionSearchType}
            selectedMentionIndex={selectedIndex}
            setSelectedMentionIndex={setSelectedIndex}
            onNavigate={() => setHasNavigated(true)}
            hasNavigated={hasNavigated}
            onInsertMentionReady={insertMention => {
              insertMentionRef.current = insertMention;
            }}
            onMentionInserted={closeSuggestions}
            open={true}
            disableAutoFocus
            {...(currentUserId ? { currentUserID: currentUserId } : {})}
            className='flex h-9 w-full items-center overflow-hidden rounded-xl border border-border bg-background pr-3 focus-within:ring-1 focus-within:ring-ring [&>div]:w-full'
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={event => event.preventDefault()}
          onInteractOutside={closeSuggestions}
          onEscapeKeyDown={closeSuggestions}
          className='z-[9999] w-[var(--radix-popover-trigger-width)] min-w-64 overflow-hidden rounded-md border border-border bg-popover shadow-lg'
        >
          {mentionSearchType === ChipType.USER ? (
            ownerSuggestions.length > 0 ? (
              <ul className='max-h-64 overflow-y-auto py-1'>
                {ownerSuggestions.map((candidate, index) => (
                  <li key={candidate.id}>
                    <button
                      type='button'
                      className={suggestionClassName(index)}
                      data-track-category='RecordingsV2'
                      data-track-name='recording_search_select_owner'
                      onMouseEnter={() => highlight(index)}
                      onClick={() => {
                        insertMentionRef.current?.({
                          id: candidate.id,
                          name: getUserDisplayName(candidate),
                          ...(candidate.email ? { email: candidate.email } : {}),
                        });
                      }}
                    >
                      <Avatar userId={candidate.id} size='sm' showActiveStatus={false} />
                      <span className='flex min-w-0 flex-col'>
                        <span className='truncate font-medium'>
                          {getUserDisplayName(candidate)}
                        </span>
                        <span className='truncate text-xs text-muted-foreground'>
                          {candidate.email}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className='px-3 py-3 text-sm text-muted-foreground'>No people found</div>
            )
          ) : labelSuggestions.length > 0 ? (
            <ul className='max-h-64 overflow-y-auto py-1'>
              {labelSuggestions.map((option, index) => (
                <li key={option.id}>
                  <button
                    type='button'
                    className={suggestionClassName(index)}
                    data-track-category='RecordingsV2'
                    data-track-name='recording_search_select_label'
                    onMouseEnter={() => highlight(index)}
                    onClick={() => {
                      insertMentionRef.current?.({ id: option.id, name: option.name });
                    }}
                  >
                    <span className='text-muted-foreground'>#</span>
                    <span className='truncate font-medium'>{option.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className='px-3 py-3 text-sm text-muted-foreground'>Type a label</div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
