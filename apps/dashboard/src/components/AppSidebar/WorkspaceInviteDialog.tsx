import {
  FormEvent,
  MouseEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { CheckTickSingle, CopyDefault } from '@xyne/icons';
import { WorkspaceRole, WorkspaceType } from '@xyne/shared';
import { toast } from 'sonner';
import Dialog from '../ui/Dialog';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import GoogleLogo from '../../assets/icons/GoogleLogo';
import MicrosoftLogo from '../../assets/icons/MicrosoftLogo';

import { apiInstance } from '../../services/clients/apiClient';
import {
  getUserContacts,
  getUserContactsProvider,
  initUserContactsOAuth,
  type UserContact,
  type UserContactsProvider,
} from '../../services/clients/userContactsApi';
import { cn } from '../../utils/classNames';

/** Dialog view: 'contacts' is used when returning from the contacts OAuth. */
export type WorkspaceInviteDialogView = 'default' | 'contacts';

type ContactsStep = 'default' | 'contacts';

interface WorkspaceInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  initialView?: WorkspaceInviteDialogView;
  /** Drives the invite role: COMMUNITY workspaces invite COMMUNITY_MEMBERs, others MEMBERs. */
  workspaceType?: WorkspaceType | undefined;
}

const EMAIL_SPLIT_PATTERN = /[\s,;]+/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The picker renders (and select-all applies to) at most this many rows. */
const VISIBLE_CONTACTS_LIMIT = 200;

const getWorkspaceInviteUrl = (workspaceId: string): string =>
  `${window.location.origin}/auth?workspaceId=${encodeURIComponent(workspaceId)}`;

const parseEmails = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(EMAIL_SPLIT_PATTERN)
        .map(email => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const getInviteErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
    return (
      error.response?.data?.error ??
      error.response?.data?.message ??
      error.message ??
      'Failed to send invitation'
    );
  }

  return error instanceof Error ? error.message : 'Failed to send invitation';
};

interface InviteResult {
  email: string;
  error?: string;
  pending?: boolean;
}

/** "Invitation sent to X" / "2 invitations sent" / "…sent for admin approval". */
const getSentToastMessage = (sent: InviteResult[]): string => {
  const pendingCount = sent.filter(result => result.pending).length;
  if (pendingCount === sent.length) {
    return sent.length === 1
      ? 'Invitation sent for admin approval'
      : `${sent.length} invitations sent for admin approval`;
  }
  const base =
    sent.length === 1
      ? `Invitation sent to ${sent.find(result => !result.pending)?.email}`
      : `${sent.length} invitations sent`;
  return pendingCount > 0 ? `${base} (${pendingCount} pending approval)` : base;
};

export const WorkspaceInviteDialog = ({
  open,
  onOpenChange,
  workspaceId,
  initialView = 'default',
  workspaceType,
}: WorkspaceInviteDialogProps): ReactElement => {
  const location = useLocation();
  const [emailsInput, setEmailsInput] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  const [contactsStep, setContactsStep] = useState<ContactsStep>('default');
  const [contactsProvider, setContactsProvider] = useState<UserContactsProvider | null>(null);
  const [contacts, setContacts] = useState<UserContact[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [invitedEmails, setInvitedEmails] = useState<Set<string>>(new Set());
  const [contactsSearch, setContactsSearch] = useState('');
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isSendingInvites, setIsSendingInvites] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  const providerLabel = contactsProvider === 'MICROSOFT' ? 'Microsoft' : 'Google';
  const inviteRole =
    workspaceType === WorkspaceType.COMMUNITY
      ? WorkspaceRole.COMMUNITY_MEMBER
      : WorkspaceRole.MEMBER;

  const inviteUrl = useMemo(
    () => (workspaceId ? getWorkspaceInviteUrl(workspaceId) : ''),
    [workspaceId],
  );

  const loadContacts = useCallback(async (): Promise<void> => {
    setIsLoadingContacts(true);
    setContactsError(null);
    try {
      const result = await getUserContacts();
      setContactsProvider(result.provider);
      if (!result.connected) {
        setContacts([]);
        setContactsError('Contacts are not connected yet. Please reconnect and try again.');
        return;
      }
      setContacts(result.contacts);
      setContactsStep('contacts');
    } catch {
      setContactsError('Failed to load contacts. Please try again.');
    } finally {
      setIsLoadingContacts(false);
    }
  }, []);

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

  useEffect(() => {
    if (!open || contactsStep !== 'default' || contactsProvider !== null) return;

    let cancelled = false;
    getUserContactsProvider()
      .then(provider => {
        if (!cancelled) setContactsProvider(provider);
      })
      .catch(() => {
        if (!cancelled) setContactsProvider(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, [open, contactsStep, contactsProvider]);

  useEffect(() => {
    if (!open) {
      setContactsStep('default');
      setContacts([]);
      setSelectedEmails(new Set());
      setInvitedEmails(new Set());
      setContactsSearch('');
      setContactsError(null);
      return;
    }

    if (initialView === 'contacts') {
      // Show the picker (with its loading state) right away; loadContacts
      // fills the list or falls back to the OAuth confirmation.
      setContactsStep('contacts');
      void loadContacts();
    }
  }, [open, initialView, loadContacts]);

  const sendInvites = useCallback(
    async (emails: string[]): Promise<InviteResult[]> => {
      if (!workspaceId || !emails.length) return [];

      return Promise.all(
        emails.map(async (email): Promise<InviteResult> => {
          try {
            const response = await apiInstance.post<{ pendingApproval?: boolean }>('/invitations', {
              email,
              role: inviteRole,
              workspaceId,
            });
            return { email, pending: response.data?.pendingApproval === true };
          } catch (error) {
            return { email, error: getInviteErrorMessage(error) };
          }
        }),
      );
    },
    [workspaceId, inviteRole],
  );

  const handleCopyLink = async (): Promise<void> => {
    if (!inviteUrl) {
      toast.error('No workspace selected');
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success('Workspace link copied to clipboard');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Failed to copy workspace link');
    }
  };

  const handleInvite = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();

    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }

    const emails = parseEmails(emailsInput);

    if (!emails.length) {
      toast.error('Please enter an email address');
      return;
    }

    const invalidEmail = emails.find(email => !EMAIL_PATTERN.test(email));
    if (invalidEmail) {
      toast.error(`Invalid email address: ${invalidEmail}`);
      return;
    }

    setIsInviting(true);
    try {
      const results = await sendInvites(emails);

      const failed = results.filter(result => result.error);
      const sent = results.filter(result => !result.error);

      if (sent.length > 0) {
        toast.success(getSentToastMessage(sent));
      }

      if (failed.length > 0) {
        const firstFailed = failed[0];
        setEmailsInput(failed.map(result => result.email).join(', '));
        toast.error(
          failed.length === 1
            ? (firstFailed?.error ?? 'Failed to send invitation')
            : `${failed.length} invitations failed`,
          {
            description:
              failed.length === 1
                ? firstFailed?.email
                : failed
                    .slice(0, 3)
                    .map(result => `${result.email}: ${result.error}`)
                    .join('\n'),
          },
        );
        return;
      }

      setEmailsInput('');
    } finally {
      setIsInviting(false);
    }
  };

  /** Current route minus the contacts OAuth return params, so the post-OAuth
      redirect lands back here without re-triggering the return handler. */
  const buildReturnPath = useCallback((): string => {
    const params = new URLSearchParams(location.search);
    params.delete('contactsImport');
    params.delete('contactsImportError');
    const search = params.toString();
    return `${location.pathname}${search ? `?${search}` : ''}`;
  }, [location.pathname, location.search]);

  /** Returns true when the browser is navigating away to the consent page —
      the loading state must be held through that, resetting it mid-navigation
      makes the button flicker back to its idle label. */
  const handleStartContactsOAuth = async (): Promise<boolean> => {
    try {
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const { authUrl } = await initUserContactsOAuth(
        isElectron ? 'electron' : 'web',
        buildReturnPath(),
      );
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authUrl);
        return false;
      }
      window.location.href = authUrl;
      return true;
    } catch {
      toast.error('Unable to start contacts authorization');
      return false;
    }
  };

  const handleOpenContactsImport = async (): Promise<void> => {
    setIsLoadingContacts(true);
    let redirectToOAuth = false;
    try {
      const result = await getUserContacts();
      setContactsProvider(result.provider);
      if (!result.connected) {
        setContacts([]);
        redirectToOAuth = true;
      } else {
        setContacts(result.contacts);
        setContactsStep('contacts');
      }
    } catch {
      toast.error('Failed to load contacts');
    } finally {
      if (!redirectToOAuth) setIsLoadingContacts(false);
    }
    if (redirectToOAuth) {
      const navigatedAway = await handleStartContactsOAuth();
      if (!navigatedAway) setIsLoadingContacts(false);
    }
  };

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

  /** Clicking anywhere on the row toggles the contact, except when the click
      landed on the checkbox itself (it already handled the toggle). */
  const handleContactRowClick = (
    event: MouseEvent<HTMLDivElement>,
    email: string,
    isSelected: boolean,
  ): void => {
    if ((event.target as HTMLElement).closest('[data-contact-row-checkbox]')) return;
    toggleContact(email, !isSelected);
  };

  const allVisibleSelected =
    visibleContacts.length > 0 &&
    visibleContacts.every(contact => selectedEmails.has(contact.email));
  const someVisibleSelected =
    !allVisibleSelected && visibleContacts.some(contact => selectedEmails.has(contact.email));

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

  const handleSendContactInvites = async (): Promise<void> => {
    const emails = Array.from(selectedEmails);
    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }
    if (!emails.length) return;

    setIsSendingInvites(true);
    try {
      const results = await sendInvites(emails);
      const sent = results.filter(result => !result.error);
      const failed = results.filter(result => result.error);

      if (sent.length > 0) {
        setInvitedEmails(previous => {
          const next = new Set(previous);
          for (const result of sent) {
            next.add(result.email);
          }
          return next;
        });
        toast.success(getSentToastMessage(sent));
      }

      if (failed.length > 0) {
        const firstFailed = failed[0];
        setSelectedEmails(new Set(failed.map(result => result.email)));
        toast.error(
          failed.length === 1
            ? (firstFailed?.error ?? 'Failed to send invitation')
            : `${failed.length} invitations failed`,
          {
            description:
              failed.length === 1
                ? firstFailed?.email
                : failed
                    .slice(0, 3)
                    .map(result => `${result.email}: ${result.error}`)
                    .join('\n'),
          },
        );
        return;
      }

      setSelectedEmails(new Set());
    } finally {
      setIsSendingInvites(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setCopied(false);
      setIsInviting(false);
    }
    onOpenChange(nextOpen);
  };

  const renderContactsStep = (): ReactElement => {
    return (
      <div className='flex max-h-[65vh] flex-col gap-4'>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0'>
            <h3 className='truncate text-[17px] font-semibold text-foreground'>
              Import from {providerLabel} Workspace
            </h3>
            <p className='mt-0.5 text-[13px] text-muted-foreground'>
              {invitedEmails.size > 0
                ? `${invitedEmails.size} of ${contacts.length} contacts invited`
                : `${contacts.length} contacts`}
            </p>
          </div>
          <button
            type='button'
            onClick={() => setContactsStep('default')}
            className='h-8 shrink-0 rounded-[10px] border border-border px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted'
            data-track-category='WorkspaceInviteDialog'
            data-track-name='ContactsPickerBack'
          >
            Back
          </button>
        </div>

        {isLoadingContacts ? (
          <div className='flex h-40 items-center justify-center text-[14px] text-muted-foreground'>
            Loading contacts...
          </div>
        ) : contactsError ? (
          <div className='space-y-4'>
            <p className='text-[14px] text-muted-foreground'>{contactsError}</p>
            <div className='flex gap-3'>
              <button
                type='button'
                onClick={() => void loadContacts()}
                className='h-9 rounded-[10px] border border-border px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted'
                data-track-category='WorkspaceInviteDialog'
                data-track-name='ContactsRetry'
              >
                Try again
              </button>
              <button
                type='button'
                onClick={() => void handleStartContactsOAuth()}
                className='h-9 rounded-[10px] bg-[#ff6368] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#f2555b]'
                data-track-category='WorkspaceInviteDialog'
                data-track-name='ContactsReconnect'
              >
                Reconnect {providerLabel}
              </button>
            </div>
          </div>
        ) : contacts.length === 0 ? (
          <div className='flex h-40 items-center justify-center text-[14px] text-muted-foreground'>
            No contacts found in your {providerLabel} account.
          </div>
        ) : (
          <>
            <div className='flex items-center justify-between gap-3'>
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected}
                onChange={handleToggleSelectAll}
                label={allVisibleSelected ? 'Deselect all' : 'Select all'}
                disabled={visibleContacts.length === 0}
                size='sm'
              />
              <input
                type='text'
                value={contactsSearch}
                onChange={event => setContactsSearch(event.target.value)}
                placeholder='Search contacts'
                className='h-9 w-44 rounded-[10px] border border-border bg-background px-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-muted-foreground/60'
                data-track-category='WorkspaceInviteDialog'
                data-track-name='ContactsSearch'
              />
            </div>

            {visibleContacts.length === 0 ? (
              <div className='flex h-32 items-center justify-center text-[14px] text-muted-foreground'>
                No contacts match your search.
              </div>
            ) : (
              <div className='-mr-1 flex-1 space-y-0.5 overflow-y-auto pr-1'>
                {visibleContacts.map(contact => {
                  const isSelected = selectedEmails.has(contact.email);
                  return (
                    <div
                      key={contact.email}
                      role='button'
                      tabIndex={0}
                      onClick={event => handleContactRowClick(event, contact.email, isSelected)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleContact(contact.email, !isSelected);
                        }
                      }}
                      data-track-category='WorkspaceInviteDialog'
                      data-track-name='ToggleContactSelection'
                      className='flex cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-muted/60'
                    >
                      <span data-contact-row-checkbox className='inline-flex shrink-0 items-center'>
                        <Checkbox
                          checked={isSelected}
                          onChange={checked => toggleContact(contact.email, checked)}
                          label=''
                          ariaLabel={`Invite ${contact.name ?? contact.email}`}
                          size='sm'
                        />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-[14px] font-medium text-foreground'>
                          {contact.name ?? contact.email}
                        </span>
                        {contact.name ? (
                          <span className='block truncate text-[13px] text-muted-foreground'>
                            {contact.email}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className='flex items-center justify-between gap-3 border-t border-border pt-4'>
              <span className='text-[13px] font-medium text-muted-foreground'>
                {selectedEmails.size} selected
              </span>
              <button
                type='button'
                onClick={() => void handleSendContactInvites()}
                disabled={selectedEmails.size === 0 || isSendingInvites}
                data-ph-capture-attribute-track-id='invite_workspace_contacts'
                className='h-10 rounded-[12px] bg-[#ff6368] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#f2555b] disabled:cursor-not-allowed disabled:opacity-70'
                data-track-category='WorkspaceInviteDialog'
                data-track-name='InviteByContacts'
              >
                {isSendingInvites ? 'Inviting...' : 'Send invites'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title='Invite people to Workspace'
      description='Invite people by email or copy a workspace link.'
      className='max-w-[460px] rounded-[18px] border border-border/70 bg-background p-0 shadow-2xl'
      testId='workspace-invite-dialog'
    >
      <div className='px-5 pb-5 pt-4'>
        <div className='mb-7 flex items-start justify-between gap-4'>
          <h2 className='text-[20px] font-semibold leading-tight tracking-normal text-foreground'>
            Invite people to Workspace
          </h2>
          <button
            type='button'
            aria-label='Close invite dialog'
            onClick={() => handleOpenChange(false)}
            className='-mr-1 flex size-6 items-center justify-center rounded-md text-[30px] font-light leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            data-track-category='WorkspaceInviteDialog'
            data-track-name='Close'
          >
            &times;
          </button>
        </div>

        {contactsStep !== 'default' ? (
          renderContactsStep()
        ) : (
          <>
            <form onSubmit={event => void handleInvite(event)} className='space-y-3'>
              <label
                htmlFor='workspace-invite-emails'
                className='block text-[15px] font-medium leading-none text-muted-foreground'
              >
                Invite via Email
              </label>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <input
                  id='workspace-invite-emails'
                  type='text'
                  value={emailsInput}
                  onChange={event => setEmailsInput(event.target.value)}
                  placeholder='jane@acme.com, jhon@acme.com'
                  disabled={isInviting}
                  className='h-10 min-w-0 flex-1 rounded-[13px] border border-border bg-background px-3.5 text-[15px] font-medium text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-muted-foreground/60 focus:ring-2 focus:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-60'
                  data-track-category='WorkspaceInviteDialog'
                  data-track-name='EmailsInput'
                />
                <button
                  type='submit'
                  data-ph-capture-attribute-track-id='invite_workspace_member'
                  disabled={isInviting || !emailsInput.trim()}
                  className='h-10 shrink-0 rounded-[12px] bg-[#ff6368] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#f2555b] disabled:cursor-not-allowed disabled:opacity-70'
                  data-track-category='WorkspaceInviteDialog'
                  data-track-name='InviteByEmail'
                >
                  {isInviting ? 'Inviting...' : 'Invite'}
                </button>
              </div>
            </form>

            {contactsProvider && (
              <>
                <div className='my-5 h-px bg-border' />

                <div className='space-y-3'>
                  <p className='text-[15px] font-medium leading-none text-muted-foreground'>
                    Invite Contacts
                  </p>
                  <button
                    type='button'
                    onClick={() => void handleOpenContactsImport()}
                    disabled={isLoadingContacts}
                    className='flex h-10 w-full items-center justify-center gap-2.5 rounded-[12px] border border-border bg-background text-[15px] font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70'
                    data-track-category='WorkspaceInviteDialog'
                    data-track-name='OpenContactsImport'
                  >
                    {contactsProvider === 'MICROSOFT' ? (
                      <MicrosoftLogo className='h-4 w-4' />
                    ) : (
                      <GoogleLogo className='h-4 w-4' />
                    )}
                    {isLoadingContacts
                      ? 'Loading contacts...'
                      : `Add from ${providerLabel} Workspace`}
                  </button>
                </div>
              </>
            )}

            <div className='my-5 h-px bg-border' />

            <div className='space-y-3'>
              <p className='text-[15px] font-medium leading-none text-muted-foreground'>
                Invite via Link
              </p>
              <div className='flex gap-1.5'>
                <div className='flex h-10 min-w-0 flex-1 items-center rounded-[7px] bg-muted px-3.5 text-[15px] font-semibold text-foreground'>
                  <span className='truncate'>{inviteUrl}</span>
                </div>
                <button
                  type='button'
                  aria-label={copied ? 'Workspace link copied' : 'Copy workspace link'}
                  onClick={() => void handleCopyLink()}
                  disabled={!inviteUrl}
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-[7px] bg-muted text-foreground transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-60',
                    copied && 'text-green-600',
                  )}
                  data-track-category='WorkspaceInviteDialog'
                  data-track-name='CopyInviteLink'
                >
                  {copied ? <CheckTickSingle size={21} /> : <CopyDefault size={21} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};

export default WorkspaceInviteDialog;
