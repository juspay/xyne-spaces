import React, { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Hash, Users, X } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import { LinkChainSlant } from '@xyne/icons';
import type { GrantableEntityUserAccess, MentionResult } from '@xyne/shared';
import { ChannelVisibility, EntityUserAccess } from '@xyne/shared';
import { useUserGroupSearch, useChannelMentionSearch } from '@xyne/shared/hooks';
import Avatar from '../ui/Avatar/Avatar';
import { Button } from '../ui/Button/Button';
import { InputBox } from '../ui/InputBox';
import { UnifiedParticipantSearch } from '../ui/UnifiedParticipantSearch/UnifiedParticipantSearch';
import type { InputBoxHandle } from '../../hooks/useDragAndDropAreaRef';
import { useActiveUserSearch } from '../../hooks/useUsers';
import { useAuth } from '../../hooks/useAuth';
import { useMentionSearch } from '../../hooks/useMentionSearch';
import { userToMentionResult } from '../../utils/userDisplayName';
import { getApiErrorMessage } from '../../utils/apiError';
import { cn } from '../../utils/classNames';

const MENTION_USER_LIMIT = 20;
const MENTION_GROUP_LIMIT = 10;

export type EntityShareTarget =
  | { type: 'user'; id: string }
  | { type: 'user_group'; id: string }
  | { type: 'channel'; id: string };

/**
 * One live share, flattened by the caller so this component never touches the
 * Zero row shapes — the recordings and calls queries return different tables.
 */
export interface EntityShareEntry {
  id: string;
  /** Who or what the entity is shared with, as shown in the access list. */
  label: string;
  /** Set for user shares, to render the avatar. */
  userId: string | null;
  target: EntityShareTarget;
  /** The conversation the share posted into, when it posted one. */
  post: { channelId: string; conversationId: string } | null;
  /** The level this share grants. Only read when `roles` is supplied. */
  access?: GrantableEntityUserAccess;
}

/**
 * Access levels, for entities that have them.
 */
export interface EntityShareRoleOptions {
  /** `false` renders the read-only list: no picker, no dropdowns, no remove. */
  canManage: boolean;
  /** Change one existing share's level in place. */
  onChangeAccess: (target: EntityShareTarget, access: GrantableEntityUserAccess) => Promise<void>;
  /** Owner's display name, for the pinned first row. Omitted while it loads. */
  ownerLabel?: string;
  /** The viewer's own share row, which offers Leave in place of Remove. */
  ownShareId?: string;
  /** Runs when the viewer leaves. Confirmation copy belongs to the caller. */
  onLeave?: () => Promise<void>;
}

export interface EntityShareModalProps {
  /** Excluded from the picker — the owner already has access. */
  ownerId: string | undefined;
  shares: EntityShareEntry[];
  onGrant: (
    targets: EntityShareTarget[],
    messageContent: string,
    access?: GrantableEntityUserAccess,
  ) => Promise<void>;
  onRevoke: (target: EntityShareTarget) => Promise<void>;
  /** The word the copy uses for what is being shared: 'recording' or 'call'. */
  subject: string;
  /** Analytics namespace of the host screen. */
  trackCategory: string;
  /**
   * Heading over the share list. Defaults to the recordings wording, which is
   * complete there — a recording starts out visible to its creator alone. A call
   * is already visible to its participants and channel, so calls say "Shared with"
   * rather than implying this list is everyone who can see it.
   */
  accessListTitle?: string;
  /** Link-access controls and anything else specific to one entity type. */
  generalAccess?: ReactNode;
  onClose?: () => void;
  /** Access levels, for entities that have them. Omit for a flat share. */
  roles?: EntityShareRoleOptions;
}

/** Sentinel select value, so Remove can sit in the same menu as the levels. */
const REMOVE_ACCESS_VALUE = '__remove_access__';

const accessLabel = (access: GrantableEntityUserAccess | undefined): string =>
  access === EntityUserAccess.EDIT ? 'Editor' : 'Viewer';

/**
 * Share and post modal shared by recordings and calls: pick people, groups or
 * channels, add an optional note, and see or remove who already has access.
 * Everything entity-specific — which service the grant goes to, and any extra
 * sections — is supplied by the wrapper (RecordingShareModal, CallShareModal).
 */
export const EntityShareModal: React.FC<EntityShareModalProps> = ({
  ownerId,
  shares,
  onGrant,
  onRevoke,
  subject,
  trackCategory,
  accessListTitle = 'People with access',
  generalAccess,
  onClose,
  roles,
}) => {
  const { user: currentUser } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [messageContent, setMessageContent] = useState('');
  const [sharing, setSharing] = useState(false);
  const [inviteAccess, setInviteAccess] = useState<GrantableEntityUserAccess>(
    EntityUserAccess.VIEW,
  );
  const inputBoxRef = useRef<InputBoxHandle>(null);

  // No `roles` means no levels: everyone who can open the modal can share.
  const canManage = roles?.canManage ?? true;

  const sharedUserIds = useMemo(
    () => new Set(shares.map(share => share.userId).filter((id): id is string => Boolean(id))),
    [shares],
  );
  const sharedUserGroupIds = useMemo(
    () =>
      new Set(
        shares.filter(share => share.target.type === 'user_group').map(share => share.target.id),
      ),
    [shares],
  );
  const sharedChannelIds = useMemo(
    () =>
      new Set(
        shares.filter(share => share.target.type === 'channel').map(share => share.target.id),
      ),
    [shares],
  );

  const excludedUserIds = useMemo(
    () =>
      new Set(
        [ownerId, currentUser?.id, ...sharedUserIds].filter((id): id is string => Boolean(id)),
      ),
    [currentUser?.id, ownerId, sharedUserIds],
  );

  // Mentions inside the note resolve against the selected channel when there is
  // one, so they match who will actually see the post.
  const selectedChannelId = useMemo(
    () =>
      selectedValues.find(value => value.startsWith('channel:'))?.replace('channel:', '') ??
      undefined,
    [selectedValues],
  );

  const { results: channelScopedMentions, searchMentions: searchChannelScopedMentions } =
    useMentionSearch(selectedChannelId);

  const [mentionQuery, setMentionQuery] = useState('');
  const mentionUsers = useActiveUserSearch(mentionQuery, MENTION_USER_LIMIT);
  const mentionGroups = useUserGroupSearch(mentionQuery, MENTION_GROUP_LIMIT);
  const workspaceMentions = useMemo<MentionResult[]>(
    () => [
      ...mentionUsers.map(u => userToMentionResult(u, u.id === currentUser?.id)),
      ...mentionGroups.map(
        (g): MentionResult => ({
          id: g.id,
          name: g.name,
          type: 'group',
          ...(g.alias && { alias: g.alias }),
          ...(g.description && { description: g.description }),
          memberCount: 0,
          isDeactivated: g.isActive === false,
        }),
      ),
    ],
    [mentionUsers, mentionGroups, currentUser?.id],
  );

  const mentionResults = selectedChannelId ? channelScopedMentions : workspaceMentions;
  const handleMentionSearch = useCallback(
    (query: string) => {
      if (selectedChannelId) {
        searchChannelScopedMentions(query);
      } else {
        setMentionQuery(query);
      }
    },
    [selectedChannelId, searchChannelScopedMentions],
  );

  const [channelMentionQuery, setChannelMentionQuery] = useState('');
  const channelMentionResults = useChannelMentionSearch(channelMentionQuery, 10);
  const channelMentionItems = useMemo(
    () =>
      channelMentionResults.map(channel => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
        ...(channel.description && { description: channel.description }),
      })),
    [channelMentionResults],
  );

  const handleShare = async (): Promise<void> => {
    if (selectedValues.length === 0) return;

    setSharing(true);
    try {
      const targets: EntityShareTarget[] = selectedValues.map(value =>
        value.startsWith('user_group:')
          ? { type: 'user_group', id: value.replace('user_group:', '') }
          : value.startsWith('channel:')
            ? { type: 'channel', id: value.replace('channel:', '') }
            : { type: 'user', id: value.replace('user:', '') },
      );
      await onGrant(targets, messageContent, roles ? inviteAccess : undefined);
      toast.success(
        selectedValues.length === 1
          ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)} shared`
          : `Shared with ${selectedValues.length} recipients`,
      );
      setSelectedValues([]);
      setSearchQuery('');
      setMessageContent('');
      onClose?.();
    } catch (error) {
      toast.error('Failed to share', {
        description: getApiErrorMessage(error, `Unable to share this ${subject}`),
      });
    } finally {
      setSharing(false);
    }
  };

  const handleRoleChange = async (share: EntityShareEntry, value: string): Promise<void> => {
    if (value === REMOVE_ACCESS_VALUE) {
      if (roles?.onLeave && share.id === roles.ownShareId) {
        await roles.onLeave();
        return;
      }
      await onRevoke(share.target);
      return;
    }
    const access = value as GrantableEntityUserAccess;
    if (access === (share.access ?? EntityUserAccess.VIEW)) return;
    try {
      await roles?.onChangeAccess(share.target, access);
    } catch (error) {
      toast.error('Failed to update access', {
        description: getApiErrorMessage(error, `Unable to change access to this ${subject}`),
      });
    }
  };

  return (
    <div className='flex flex-col w-full p-5 gap-4'>
      {canManage && (
        <div className='space-y-2'>
          <p className='text-muted-foreground text-[13px] leading-5'>
            Share with people, groups, or channels
          </p>
          <div className='flex items-start gap-2'>
            <div className='min-w-0 flex-1'>
              <UnifiedParticipantSearch
                selectedValues={selectedValues}
                onMultiSelect={setSelectedValues}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                excludedUserIds={excludedUserIds}
                excludedUserGroupIds={sharedUserGroupIds}
                excludedChannelIds={sharedChannelIds}
                exclusiveSelection={false}
              />
            </div>
            {roles && (
              <ShareRoleSelect
                bordered
                value={inviteAccess}
                onChange={value => setInviteAccess(value as GrantableEntityUserAccess)}
              />
            )}
          </div>
          {roles && inviteAccess === EntityUserAccess.EDIT && (
            <p className='text-muted-foreground text-xs'>
              Editors can edit this {subject} and manage who has access. They can&apos;t delete it.
            </p>
          )}
        </div>
      )}

      {canManage && (
        <div
          className='space-y-1.5'
          data-track-category={trackCategory}
          data-track-name={`share_${subject}_message_input`}
          onKeyDownCapture={event => {
            if (event.key === 'Enter' && !event.shiftKey && selectedValues.length > 0) {
              if (inputBoxRef.current?.isSuggestionOpen()) return;
              event.preventDefault();
              event.stopPropagation();
              void handleShare();
            }
          }}
        >
          <label htmlFor={`share-${subject}-message`} className='text-muted-foreground text-[13px]'>
            Add a message (optional)
          </label>
          <InputBox
            ref={inputBoxRef}
            id={`share-${subject}-message`}
            placeholder={`Say something about this ${subject}...`}
            onSendMessage={() => {}}
            onContentChange={(html, _text) => {
              setMessageContent(html);
            }}
            mentionItems={mentionResults}
            onMentionSearch={handleMentionSearch}
            channelItems={channelMentionItems}
            onChannelSearch={setChannelMentionQuery}
            features={{
              richText: true,
              mentions: true,
              commands: false,
              fileAttachments: false,
              emojiPicker: true,
            }}
            showTypingIndicator={false}
            disabled={sharing}
            disableEnterToSend
            hideSendButton
          />
        </div>
      )}

      {canManage && (
        <div className='flex justify-end'>
          <Button
            size='sm'
            onClick={() => void handleShare()}
            disabled={selectedValues.length === 0 || sharing}
            data-track-category={trackCategory}
            data-track-name={`share_${subject}_confirm`}
          >
            {sharing ? 'Sharing...' : 'Share'}
          </Button>
        </div>
      )}

      {(shares.length > 0 || !!roles?.ownerLabel) && (
        <div className='space-y-2 border-t border-border pt-3'>
          <p className='text-muted-foreground text-[13px]'>{accessListTitle}</p>
          <div className='space-y-3.5 max-h-60 overflow-y-auto pr-1'>
            {/* Pinned first, no dropdown: ownership neither transfers nor revokes. */}
            {roles?.ownerLabel && (
              <div className='flex items-center justify-between gap-2'>
                <div className='flex items-center gap-2 min-w-0'>
                  <Avatar userId={ownerId ?? null} size='sm' showActiveStatus={false} />
                  <span className='text-sm truncate'>{roles.ownerLabel}</span>
                </div>
                <span className='shrink-0 px-2 text-sm text-muted-foreground'>Owner</span>
              </div>
            )}
            {shares.map(share => {
              const icon =
                share.target.type === 'user_group' ? (
                  <Users className='size-4 text-muted-foreground shrink-0' />
                ) : share.target.type === 'channel' ? (
                  <Hash className='size-4 text-muted-foreground shrink-0' />
                ) : (
                  <Avatar userId={share.userId} size='sm' showActiveStatus={false} />
                );

              return (
                <div key={share.id} className='group flex items-center justify-between gap-2'>
                  <div className='flex items-center gap-2 min-w-0'>
                    {icon}
                    <span className='text-sm truncate'>{share.label}</span>
                    {share.post && (
                      <Link
                        to={`/chat/dir/${share.post.channelId}/${share.post.conversationId}`}
                        className='shrink-0 text-muted-foreground transition-colors hover:text-foreground'
                        aria-label='Open shared conversation'
                        data-track-category={trackCategory}
                        data-track-name={`open_${subject}_share_conversation`}
                      >
                        <LinkChainSlant className='size-3.5' aria-hidden='true' />
                      </Link>
                    )}
                  </div>
                  {!roles ? (
                    <button
                      type='button'
                      onClick={() => void onRevoke(share.target)}
                      className='shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
                      aria-label='Remove access'
                      data-track-category={trackCategory}
                      data-track-name={`revoke_${subject}_share`}
                    >
                      <X className='size-3.5' />
                    </button>
                  ) : canManage ? (
                    <ShareRoleSelect
                      value={share.access ?? EntityUserAccess.VIEW}
                      allowRemove
                      {...(roles.onLeave && share.id === roles.ownShareId
                        ? { removeLabel: 'Leave' }
                        : {})}
                      onChange={value => void handleRoleChange(share, value)}
                    />
                  ) : (
                    <div className='flex items-center gap-2 shrink-0'>
                      <span className='text-sm text-muted-foreground'>
                        {accessLabel(share.access)}
                      </span>
                      {/* A viewer's one control: removing their own access. */}
                      {roles.onLeave && share.id === roles.ownShareId && (
                        <button
                          type='button'
                          onClick={() => void roles.onLeave?.()}
                          className='rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground'
                          data-track-category={trackCategory}
                          data-track-name={`leave_${subject}_share`}
                        >
                          Leave
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {generalAccess}
    </div>
  );
};

interface ShareRoleSelectProps {
  value: GrantableEntityUserAccess;
  /** Adds a separated remove item below the levels. */
  allowRemove?: boolean;
  removeLabel?: string;
  bordered?: boolean;
  onChange: (value: string) => void;
}

/**
 * Viewer / Editor picker, mirroring CanvasShareModal's RoleSelect. ADMIN and
 * OWNER are not grantable here.
 */
const ShareRoleSelect: React.FC<ShareRoleSelectProps> = ({
  value,
  allowRemove,
  removeLabel = 'Remove access',
  bordered,
  onChange,
}) => (
  <Select.Root value={value} onValueChange={onChange}>
    <Select.Trigger
      className={cn(
        'inline-flex items-center gap-1 shrink-0 text-sm text-foreground border outline-none',
        bordered
          ? 'h-10 px-3 rounded-lg border-border bg-background duration-300 ease-in-out data-[state=open]:border-foreground focus-visible:border-foreground'
          : 'h-8 px-2 rounded-md border-transparent hover:border-input hover:bg-background data-[state=open]:border-input focus-visible:border-ring',
      )}
      aria-label='Change access level'
    >
      <Select.Value>{accessLabel(value)}</Select.Value>
      <Select.Icon>
        <ChevronDown className='size-3.5 opacity-50' />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content
        position='popper'
        sideOffset={4}
        align='end'
        className='z-[70] min-w-[160px] overflow-hidden rounded-lg border border-border bg-popover shadow-md'
      >
        <Select.Viewport className='p-1'>
          {[EntityUserAccess.VIEW, EntityUserAccess.EDIT].map(level => (
            <Select.Item
              key={level}
              value={level}
              className='relative flex items-center pl-7 pr-2 py-1.5 text-sm rounded-md cursor-pointer outline-none select-none data-[highlighted]:bg-accent'
            >
              <Select.ItemIndicator className='absolute left-1.5'>
                <Check className='size-3.5' />
              </Select.ItemIndicator>
              <Select.ItemText>{accessLabel(level)}</Select.ItemText>
            </Select.Item>
          ))}
          {allowRemove && (
            <>
              <div className='h-px bg-border my-1' role='separator' aria-hidden='true' />
              <Select.Item
                value={REMOVE_ACCESS_VALUE}
                className='relative flex items-center pl-7 pr-2 py-1.5 text-sm rounded-md cursor-pointer text-red-600 outline-none select-none data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-950/40'
              >
                <Select.ItemText>{removeLabel}</Select.ItemText>
              </Select.Item>
            </>
          )}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
);
