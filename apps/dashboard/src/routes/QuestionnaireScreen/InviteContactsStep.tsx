import { KeyboardEvent, ReactElement, useMemo, useState } from 'react';
import { ArrowRight } from '@xyne/icons';
import { Check, Loader2, Search } from 'lucide-react';
import { WorkspaceRole, WorkspaceType } from '@xyne/shared';
import { toast } from 'sonner';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { apiInstance } from '../../services/clients/apiClient';
import type { UserContact, UserContactsProvider } from '../../services/clients/userContactsApi';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import GoogleLogo from '../../assets/icons/GoogleLogo';
import MicrosoftLogo from '../../assets/icons/MicrosoftLogo';

/** The picker renders (and select-all applies to) at most this many rows. */
const VISIBLE_CONTACTS_LIMIT = 200;

/** Soft gradient pairs for contact initials — echoes the onboarding illustrations. */
const AVATAR_GRADIENTS = [
  'from-[#FF8C8C] to-[#FF4F4F]',
  'from-[#98C464] to-[#DCA47C]',
  'from-[#7BA7F9] to-[#4D8BFF]',
  'from-[#F2A93B] to-[#F2762E]',
  'from-[#B48CF2] to-[#7C5CE0]',
  'from-[#5BC8C4] to-[#2E9E9A]',
] as const;

const avatarGradientFor = (seed: string): string => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]!;
};

const initialsFor = (contact: UserContact): string => {
  const source = contact.name?.trim() || contact.email;
  return (source[0] || '?').toUpperCase();
};

const providerLabel = (provider: UserContactsProvider): string =>
  provider === 'MICROSOFT' ? 'Microsoft' : 'Google';

interface InviteResult {
  email: string;
  error?: string;
}

interface PanelProps {
  contacts: UserContact[];
  provider: UserContactsProvider;
  workspaceId: string;
  invitedEmails: Set<string>;
  onInvited: (emails: string[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export const InviteContactsStepPanel = ({
  contacts,
  provider,
  workspaceId,
  invitedEmails,
  onInvited,
  onBack,
  onNext,
}: PanelProps): ReactElement => {
  const [contactsSearch, setContactsSearch] = useState('');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);

  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId || '' }), {
    enabled: Boolean(workspaceId),
  }) as unknown as [{ workspaceType?: string } | undefined];
  const inviteRole =
    workspace?.workspaceType === WorkspaceType.COMMUNITY
      ? WorkspaceRole.COMMUNITY_MEMBER
      : WorkspaceRole.MEMBER;

  /** Contacts left to invite, filtered by the search box. */
  const visibleContacts = useMemo(() => {
    const query = contactsSearch.trim().toLowerCase();
    const pending = contacts.filter(contact => !invitedEmails.has(contact.email));
    const filtered = query
      ? pending.filter(
          contact =>
            contact.email.toLowerCase().includes(query) ||
            (contact.name?.toLowerCase().includes(query) ?? false),
        )
      : pending;
    return filtered.slice(0, VISIBLE_CONTACTS_LIMIT);
  }, [contacts, contactsSearch, invitedEmails]);

  const allVisibleSelected =
    visibleContacts.length > 0 &&
    visibleContacts.every(contact => selectedEmails.has(contact.email));
  const someVisibleSelected =
    !allVisibleSelected && visibleContacts.some(contact => selectedEmails.has(contact.email));

  const toggleContact = (email: string, checked: boolean): void => {
    setSelectedEmails(previous => {
      const next = new Set(previous);
      if (checked) {
        next.add(email);
      } else {
        next.delete(email);
      }
      return next;
    });
  };

  const handleToggleSelectAll = (checked: boolean): void => {
    setSelectedEmails(previous => {
      const next = new Set(previous);
      for (const contact of visibleContacts) {
        if (checked) {
          next.add(contact.email);
        } else {
          next.delete(contact.email);
        }
      }
      return next;
    });
  };

  const handleSendInvites = async (): Promise<void> => {
    const emails = Array.from(selectedEmails);
    if (!workspaceId || !emails.length || isSending) return;

    setIsSending(true);
    try {
      const results = await Promise.all(
        emails.map(async (email): Promise<InviteResult> => {
          try {
            await apiInstance.post('/invitations', {
              email,
              role: inviteRole,
              workspaceId,
            });
            return { email };
          } catch (error) {
            const message =
              (error as { response?: { data?: { error?: string; message?: string } } })?.response
                ?.data?.error ??
              (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
              (error instanceof Error ? error.message : 'Failed to send invitation');
            return { email, error: message };
          }
        }),
      );

      const sent = results.filter(result => !result.error);
      const failed = results.filter(result => result.error);

      if (sent.length > 0) {
        onInvited(sent.map(result => result.email));
        toast.success(
          sent.length === 1
            ? `Invitation sent to ${sent[0]?.email}`
            : `${sent.length} invitations sent`,
        );
      }

      if (failed.length > 0) {
        toast.error(
          failed.length === 1
            ? (failed[0]?.error ?? 'Failed to send invitation')
            : `${failed.length} invitations failed`,
          {
            description: failed
              .slice(0, 3)
              .map(result => `${result.email}: ${result.error}`)
              .join('\n'),
          },
        );
        return;
      }

      setSelectedEmails(new Set());
    } finally {
      setIsSending(false);
    }
  };

  const handlePrimaryAction = (): void => {
    if (selectedEmails.size > 0) {
      void handleSendInvites();
      return;
    }
    onNext();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    email: string,
    isSelected: boolean,
  ): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleContact(email, !isSelected);
    }
  };

  const hasSelection = selectedEmails.size > 0;

  return (
    <div className='flex-1 flex flex-col justify-center max-w-[520px] w-full md:absolute md:left-12 lg:left-[100px] md:top-[276px] md:bottom-[38px] md:w-[calc(100%_-_96px)] lg:w-[calc(100%_-_200px)] md:max-w-[776px] md:justify-start'>
      <h1 className='text-[28px] leading-[34px] font-bold text-[#242936]'>Bring your team along</h1>
      <p className='mt-2 flex items-center gap-1.5 text-[14px] leading-[22px] text-[#777B85]'>
        {provider === 'MICROSOFT' ? (
          <MicrosoftLogo className='h-3.5 w-3.5 shrink-0' />
        ) : (
          <GoogleLogo className='h-3.5 w-3.5 shrink-0' />
        )}
        Your {providerLabel(provider)} contacts are ready — pick people to invite to your workspace
      </p>

      <div className='relative mt-[24px]'>
        <Search className='pointer-events-none absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#B2B6BE]' />
        <input
          type='text'
          value={contactsSearch}
          onChange={event => setContactsSearch(event.target.value)}
          placeholder='Search contacts'
          autoComplete='off'
          className='h-[44px] w-full pl-[38px] pr-[13px] border border-[#DDE3EC] rounded-[9px] bg-white text-[14px] text-[#272B35] placeholder:text-[#B2B6BE] focus:outline-none focus:border-[#AEB7C5] transition-colors'
          data-track-category='Questionnaire'
          data-track-name='InviteContactsSearch'
        />
      </div>

      <div className='mt-[14px] flex items-center justify-between gap-3'>
        <Checkbox
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected}
          onChange={handleToggleSelectAll}
          label={allVisibleSelected ? 'Deselect all' : 'Select all'}
          disabled={visibleContacts.length === 0}
          size='sm'
        />
        <span className='text-[13px] leading-none font-medium text-[#8E939D]'>
          {invitedEmails.size > 0
            ? `${invitedEmails.size} of ${contacts.length} invited`
            : `${contacts.length} contacts`}
        </span>
      </div>

      <div className='-mr-2 mt-[6px] max-h-[240px] md:max-h-[280px] space-y-0.5 overflow-y-auto pr-2'>
        {visibleContacts.length === 0 ? (
          <div className='flex h-[120px] items-center justify-center text-[14px] text-[#8E939D]'>
            {contactsSearch.trim()
              ? 'No contacts match your search.'
              : 'No contacts left to invite — you got them all!'}
          </div>
        ) : (
          visibleContacts.map((contact, index) => {
            const isSelected = selectedEmails.has(contact.email);
            return (
              <div
                key={contact.email}
                role='button'
                tabIndex={0}
                onClick={() => toggleContact(contact.email, !isSelected)}
                onKeyDown={event => handleRowKeyDown(event, contact.email, isSelected)}
                style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                className='flex cursor-pointer select-none items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[#F8FAFC] focus:outline-none focus-visible:bg-[#F8FAFC] animate-[fadeUp_.4s_ease-out_both]'
                data-track-category='Questionnaire'
                data-track-name='ToggleInviteContact'
              >
                <span
                  className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[13px] font-bold text-white ${avatarGradientFor(contact.email)}`}
                >
                  {initialsFor(contact)}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-[14px] font-medium leading-[18px] text-[#272B35]'>
                    {contact.name ?? contact.email}
                  </span>
                  {contact.name ? (
                    <span className='block truncate text-[12px] leading-[16px] text-[#8E939D]'>
                      {contact.email}
                    </span>
                  ) : null}
                </span>
                <span className='inline-flex shrink-0 items-center' data-contact-row-checkbox>
                  <Checkbox
                    checked={isSelected}
                    onChange={checked => toggleContact(contact.email, checked)}
                    label=''
                    ariaLabel={`Invite ${contact.name ?? contact.email}`}
                    size='sm'
                  />
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className='mt-auto mb-4 md:mb-0 flex items-center gap-5 pt-[18px]'>
        <button
          type='button'
          onClick={onBack}
          className='text-[14px] text-[#8E939D] hover:text-[#272B35] transition-colors'
          data-track-category='Questionnaire'
          data-track-name='InviteContactsBack'
        >
          Back
        </button>
        <button
          type='button'
          onClick={handlePrimaryAction}
          disabled={isSending}
          className='inline-flex h-[48px] items-center gap-2.5 px-5 bg-[#FF6868] text-white text-[15px] font-semibold rounded-[10px] hover:bg-[#FF5A5A] disabled:opacity-60 disabled:cursor-not-allowed transition-colors'
          data-track-category='Questionnaire'
          data-track-name='InviteContactsPrimary'
        >
          {isSending ? (
            <>
              Inviting
              <Loader2 className='w-4 h-4 animate-spin' />
            </>
          ) : hasSelection ? (
            <>Send {selectedEmails.size === 1 ? 'invite' : `${selectedEmails.size} invites`}</>
          ) : (
            <>
              Next
              <ArrowRight className='w-4 h-4' />
            </>
          )}
        </button>
        {hasSelection ? (
          <button
            type='button'
            onClick={onNext}
            className='text-[14px] text-[#8E939D] hover:text-[#272B35] transition-colors'
            data-track-category='Questionnaire'
            data-track-name='InviteContactsSkip'
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </div>
  );
};

interface PreviewProps {
  contacts: UserContact[];
  invitedEmails: Set<string>;
}

export const InviteContactsPreview = ({ contacts, invitedEmails }: PreviewProps): ReactElement => {
  const invited = useMemo(
    () => contacts.filter(contact => invitedEmails.has(contact.email)),
    [contacts, invitedEmails],
  );

  return (
    <div className='flex w-full max-w-[480px] flex-col items-center px-8'>
      <div className='w-full rounded-[16px] border border-[#E2E5EA] bg-white shadow-[0_18px_38px_rgba(27,36,52,0.13)] overflow-hidden'>
        <div className='flex h-[48px] items-center justify-center border-b border-[#ECEFF3]'>
          <span className='text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8E939D]'>
            Joining your workspace
          </span>
        </div>

        {invited.length === 0 ? (
          <div className='flex flex-col items-center gap-4 px-[26px] py-[38px] text-center'>
            <div className='flex -space-x-2.5'>
              {['#FFD9D9', '#E4E9F2', '#DDECE2'].map(background => (
                <span
                  key={background}
                  style={{ backgroundColor: background }}
                  className='flex h-[46px] w-[46px] items-center justify-center rounded-full border-2 border-white'
                >
                  <span className='h-[14px] w-[14px] rounded-full bg-white/70' />
                </span>
              ))}
            </div>
            <p className='text-[15px] leading-[22px] text-[#777B85]'>
              Pick people on the left — they&apos;ll get an email invite to join your workspace
            </p>
          </div>
        ) : (
          <div className='flex flex-col gap-1 px-[22px] py-[24px]'>
            {invited.slice(0, 5).map(contact => (
              <div key={contact.email} className='flex items-center gap-3 py-[7px]'>
                <span
                  className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[13px] font-bold text-white ${avatarGradientFor(contact.email)}`}
                >
                  {initialsFor(contact)}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-[15px] font-semibold leading-[19px] text-[#242936]'>
                    {contact.name ?? contact.email}
                  </span>
                  {contact.name ? (
                    <span className='block truncate text-[12px] leading-[16px] text-[#8E939D]'>
                      {contact.email}
                    </span>
                  ) : null}
                </span>
                <span className='inline-flex shrink-0 items-center gap-1 rounded-full bg-[#E7F6EE] px-2.5 py-1 text-[11px] font-semibold text-[#22A06B]'>
                  <Check className='h-3 w-3' strokeWidth={3} />
                  Invited
                </span>
              </div>
            ))}
            {invited.length > 5 ? (
              <p className='pt-1 pl-[48px] text-[13px] font-medium text-[#8E939D]'>
                +{invited.length - 5} more invited
              </p>
            ) : null}
          </div>
        )}
      </div>

      <p className='mt-[18px] text-center text-[14px] leading-[20px] text-[#8E939D]'>
        {invited.length === 1
          ? `${invited[0]?.name ?? invited[0]?.email} got an email invite`
          : invited.length > 1
            ? `${invited.length} invitations are on their way`
            : 'Invites you send will show up here'}
      </p>
    </div>
  );
};
