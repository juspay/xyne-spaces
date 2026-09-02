import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from 'react';
import { Hash, Lock, MessageCircle, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { ChannelVisibility } from '@xyne/shared';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { keyBetween, isDMChannel, getDMSearchableName } from '../ChatDirectory/ChatDirectory.utils';
import { SectionEmojiPicker } from '../SectionEmojiPicker';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import type { VisibleChannel } from '../../../machines/stateMachine';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface CreateSectionDialogProps {
  channels: VisibleChannel[];
  existingNames: string[];
  lastSectionPosition: string | null;
  onClose: () => void;
}

const ChannelRow = ({
  channel,
  selected,
  onToggle,
}: {
  channel: VisibleChannel;
  selected: boolean;
  onToggle: () => void;
}): ReactElement => {
  const { userID } = useAuthContextValues();
  const { displayName } = useChannelDisplayName(channel, userID);
  const isDM = isDMChannel(channel.scopeType);
  return (
    <label className='flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-sidebar-item-hover'>
      <input
        type='checkbox'
        checked={selected}
        onChange={onToggle}
        data-track-category='CHAT_SIDEBAR'
        data-track-name='CREATE_SECTION_TOGGLE_CHANNEL'
        className='size-4 accent-action-primary'
      />
      <span className='shrink-0 text-muted-foreground'>
        {isDM ? (
          <MessageCircle size={14} />
        ) : channel.visibility === ChannelVisibility.PRIVATE ? (
          <Lock size={14} />
        ) : (
          <Hash size={14} />
        )}
      </span>
      <span className='flex-1 truncate text-sm text-foreground'>{displayName}</span>
    </label>
  );
};

export const CreateSectionDialog = ({
  channels,
  existingNames,
  lastSectionPosition,
  onClose,
}: CreateSectionDialogProps): ReactElement => {
  const zero = useZero();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [touched, setTouched] = useState(false);
  const [createdSectionId, setCreatedSectionId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { userID } = useAuthContextValues();
  const allUsers = useUsers();

  const showHintOnDismissRef = useRef(false);
  useEffect(() => {
    return () => {
      if (showHintOnDismissRef.current) {
        toast(
          'Tip: drag dms/channels from the sidebar and drop them into your section to add them.',
          {
            duration: 5000,
          },
        );
      }
    };
  }, []);

  const trimmedName = name.trim();
  const isDuplicateName = existingNames.some(
    n => n.trim().toLowerCase() === trimmedName.toLowerCase(),
  );
  const nameError =
    trimmedName.length === 0
      ? 'Section name is required'
      : trimmedName.length > 50
        ? 'Section name must be 50 characters or less'
        : isDuplicateName
          ? 'A section with this name already exists'
          : null;
  const showError = touched && !!nameError;

  const handleCreateAndContinue = (e: FormEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (nameError) {
      setTouched(true);
      return;
    }
    const id = crypto.randomUUID();
    const trimmedEmoji = emoji.trim();
    void zero.mutate(
      mutators.channelSection.create({
        id,
        name: trimmedName,
        emoji: trimmedEmoji || null,
        position: keyBetween(lastSectionPosition, null),
        timestamp: Date.now(),
      }),
    );
    showHintOnDismissRef.current = true;
    setCreatedSectionId(id);
    setStep(2);
  };
  const userMap = useMemo(
    () => new Map(allUsers.map(u => [u.id, getUserDisplayName(u)])),
    [allUsers],
  );

  const filteredChannels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = !q
      ? channels
      : channels.filter(c => getDMSearchableName(c, userMap, userID).toLowerCase().includes(q));
    return [...base].sort((a, b) => {
      const aSelected = selected.has(a.id) ? 0 : 1;
      const bSelected = selected.has(b.id) ? 0 : 1;
      return aSelected - bSelected;
    });
  }, [channels, filter, selected, userMap, userID]);

  const allFilteredSelected =
    filteredChannels.length > 0 && filteredChannels.every(c => selected.has(c.id));

  const toggleChannel = (id: string): void => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredChannels.forEach(c => next.delete(c.id));
      } else {
        filteredChannels.forEach(c => next.add(c.id));
      }
      return next;
    });
  };

  const handleAddChannels = (): void => {
    if (createdSectionId && selected.size > 0) {
      const timestamp = Date.now();
      let prevKey: string | null = null;
      for (const channelId of selected) {
        const position = keyBetween(prevKey, null);
        void zero.mutate(
          mutators.channel.moveToSection({
            channelId,
            sectionId: createdSectionId,
            position,
            timestamp,
          }),
        );
        prevKey = position;
      }
      showHintOnDismissRef.current = false;
    }
    onClose();
  };

  const handleSkip = (): void => {
    showHintOnDismissRef.current = false;
    toast('Tip: drag dms/channels from the sidebar and drop them into your section to add them.', {
      duration: 5000,
    });
    onClose();
  };

  const closeButton = (
    <button
      type='button'
      onClick={step === 2 ? handleSkip : onClose}
      aria-label='Close'
      data-track-category='CHAT_SIDEBAR'
      data-track-name='CLOSE_CREATE_SECTION'
      className='-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
    >
      <X className='size-5' />
    </button>
  );

  if (step === 1) {
    return (
      <form
        onSubmit={handleCreateAndContinue}
        className='space-y-4 p-4'
        data-testid='create-section-step1'
      >
        <div className='flex items-start justify-between gap-2'>
          <div className='text-xl font-medium text-foreground'>Create a section</div>
          {closeButton}
        </div>
        <div className='space-y-1.5'>
          <label htmlFor='section-name' className='text-sm font-medium text-foreground'>
            Section name
          </label>
          <div
            className={cn(
              'flex items-center gap-1 rounded-md border bg-background px-2 transition-colors',
              showError
                ? 'border-destructive'
                : 'border-border focus-within:ring-2 focus-within:ring-ring',
            )}
          >
            <SectionEmojiPicker
              value={emoji}
              onChange={setEmoji}
              trackName='CREATE_SECTION_EMOJI'
            />
            <input
              id='section-name'
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setName(e.target.value);
                setTouched(true);
              }}
              onKeyDown={e => {
                if (
                  e.key === 'Backspace' &&
                  emoji &&
                  e.currentTarget.selectionStart === 0 &&
                  e.currentTarget.selectionEnd === 0
                ) {
                  e.preventDefault();
                  setEmoji('');
                }
              }}
              placeholder='Ex: Project Beta'
              maxLength={50}
              autoFocus
              autoComplete='off'
              aria-invalid={showError}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CREATE_SECTION_NAME'
              className='flex-1 border-0 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
            />
          </div>
          {showError && <p className='text-sm text-destructive'>{nameError}</p>}
        </div>
        <div className='flex items-center justify-between pt-2'>
          <span className='text-sm text-muted-foreground'>Step 1 of 2</span>
          <Tooltip content={nameError ?? ''} side='top' {...(!nameError && { open: false })}>
            <span className='inline-flex'>
              <Button
                type='submit'
                variant='default'
                size='default'
                trackId='create_section'
                disabled={!!nameError}
                className={cn(
                  'bg-action-primary text-action-primary-foreground hover:bg-action-primary/90',
                  !!nameError && 'pointer-events-none',
                )}
              >
                Create and Add Channels
              </Button>
            </span>
          </Tooltip>
        </div>
      </form>
    );
  }

  return (
    <div className='space-y-4 p-4' data-testid='create-section-step2'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='text-xl font-medium text-foreground'>Add channels</div>
          <div className='flex items-center gap-1 text-sm text-muted-foreground'>
            {emoji.trim() && renderEmoji(emoji.trim(), 'size-4')}
            <span>{trimmedName}</span>
          </div>
        </div>
        {closeButton}
      </div>

      <div className='flex items-center gap-2 rounded-md border border-border bg-background px-2 focus-within:ring-2 focus-within:ring-ring'>
        <Search className='size-4 shrink-0 text-muted-foreground' />
        <input
          value={filter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          placeholder='Filter by name…'
          autoComplete='off'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='CREATE_SECTION_FILTER_CHANNELS'
          className='flex-1 border-0 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
        />
      </div>

      <div className='rounded-md border border-border'>
        <label className='flex cursor-pointer items-center justify-between gap-2 border-b border-border px-3 py-2'>
          <span className='flex items-center gap-2 text-sm font-medium text-foreground'>
            <input
              type='checkbox'
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CREATE_SECTION_SELECT_ALL'
              className='size-4 accent-action-primary'
            />
            Select all
          </span>
          <span className='text-xs text-muted-foreground'>{selected.size} selected</span>
        </label>
        <div className='max-h-64 overflow-y-auto'>
          {filteredChannels.length === 0 ? (
            <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
              No channels found
            </div>
          ) : (
            filteredChannels.map(channel => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                selected={selected.has(channel.id)}
                onToggle={() => toggleChannel(channel.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className='flex items-center justify-between pt-2'>
        <span className='text-sm text-muted-foreground'>Step 2 of 2</span>
        <div className='flex gap-3'>
          <Button
            type='button'
            variant='outline'
            size='default'
            onClick={handleSkip}
            data-track-category='CHAT_SIDEBAR'
            data-track-name='SKIP_ADD_CHANNELS_TO_SECTION'
          >
            Skip
          </Button>
          <Button
            type='button'
            variant='default'
            size='default'
            onClick={handleAddChannels}
            trackId='add_channels_to_section'
            data-track-category='CHAT_SIDEBAR'
            data-track-name='ADD_CHANNELS_TO_SECTION'
            disabled={selected.size === 0}
            className='bg-action-primary text-action-primary-foreground hover:bg-action-primary/90'
          >
            Add Channels
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateSectionDialog;
