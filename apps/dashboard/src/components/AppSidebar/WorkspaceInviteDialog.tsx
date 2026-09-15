import { FormEvent, ReactElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import { CheckTickSingle, CopyDefault } from '@xyne/icons';
import { WorkspaceRole } from '@xyne/shared';
import { toast } from 'sonner';
import Dialog from '../ui/Dialog';

import { apiInstance } from '../../services/clients/apiClient';
import { cn } from '../../utils/classNames';

interface WorkspaceInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
}

const EMAIL_SPLIT_PATTERN = /[\s,;]+/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const getInviteErrorMessage = (error: unknown, t: TFunction): string => {
  if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
    return (
      error.response?.data?.error ??
      error.response?.data?.message ??
      error.message ??
      t('appSidebar.workspaceInvite.failedToSend')
    );
  }

  return error instanceof Error ? error.message : t('appSidebar.workspaceInvite.failedToSend');
};

interface InviteResult {
  email: string;
  error?: string;
}

export const WorkspaceInviteDialog = ({
  open,
  onOpenChange,
  workspaceId,
}: WorkspaceInviteDialogProps): ReactElement => {
  const { t } = useTranslation('placeholders');
  const { t: tc } = useTranslation('common');
  const [emailsInput, setEmailsInput] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  const inviteUrl = useMemo(
    () => (workspaceId ? getWorkspaceInviteUrl(workspaceId) : ''),
    [workspaceId],
  );

  const handleCopyLink = async (): Promise<void> => {
    if (!inviteUrl) {
      toast.error(tc('appSidebar.workspaceInvite.noWorkspaceSelected'));
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success(tc('appSidebar.workspaceInvite.linkCopied'));
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(tc('appSidebar.workspaceInvite.copyFailed'));
    }
  };

  const handleInvite = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();

    if (!workspaceId) {
      toast.error(tc('appSidebar.workspaceInvite.noWorkspaceSelected'));
      return;
    }

    const emails = parseEmails(emailsInput);

    if (!emails.length) {
      toast.error(tc('appSidebar.workspaceInvite.enterEmail'));
      return;
    }

    const invalidEmail = emails.find(email => !EMAIL_PATTERN.test(email));
    if (invalidEmail) {
      toast.error(tc('appSidebar.workspaceInvite.invalidEmail', { email: invalidEmail }));
      return;
    }

    setIsInviting(true);
    try {
      const results = await Promise.all(
        emails.map(async (email): Promise<InviteResult> => {
          try {
            await apiInstance.post('/invitations', {
              email,
              role: WorkspaceRole.COMMUNITY_MEMBER,
              workspaceId,
            });
            return { email };
          } catch (error) {
            return { email, error: getInviteErrorMessage(error, tc) };
          }
        }),
      );

      const failed = results.filter(result => result.error);
      const sentCount = results.length - failed.length;

      if (sentCount > 0) {
        toast.success(
          sentCount === 1
            ? tc('appSidebar.workspaceInvite.invitationSentTo', {
                email: results.find(result => !result.error)?.email,
              })
            : tc('appSidebar.workspaceInvite.invitationsSentCount', { count: sentCount }),
        );
      }

      if (failed.length > 0) {
        const firstFailed = failed[0];
        setEmailsInput(failed.map(result => result.email).join(', '));
        toast.error(
          failed.length === 1
            ? (firstFailed?.error ?? tc('appSidebar.workspaceInvite.failedToSend'))
            : tc('appSidebar.workspaceInvite.invitationsFailedCount', { count: failed.length }),
          {
            description:
              failed.length === 1
                ? firstFailed?.email
                : failed
                    .slice(0, 3)
                    .map(result =>
                      tc('appSidebar.workspaceInvite.emailColonError', {
                        email: result.email,
                        error: result.error,
                      }),
                    )
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

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setCopied(false);
      setIsInviting(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tc('appSidebar.workspaceInvite.title')}
      description={tc('appSidebar.workspaceInvite.description')}
      className='max-w-[460px] rounded-[18px] border border-border/70 bg-background p-0 shadow-2xl'
      testId='workspace-invite-dialog'
    >
      <form onSubmit={event => void handleInvite(event)} className='px-5 pb-5 pt-4'>
        <div className='mb-7 flex items-start justify-between gap-4'>
          <h2 className='text-[20px] font-semibold leading-tight tracking-normal text-foreground'>
            {tc('appSidebar.workspaceInvite.title')}
          </h2>
          <button
            type='button'
            aria-label={tc('appSidebar.workspaceInvite.closeAriaLabel')}
            onClick={() => handleOpenChange(false)}
            className='-mr-1 flex size-6 items-center justify-center rounded-md text-[30px] font-light leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            data-track-category='WorkspaceInviteDialog'
            data-track-name='Close'
          >
            &times;
          </button>
        </div>

        <div className='space-y-3'>
          <label
            htmlFor='workspace-invite-emails'
            className='block text-[15px] font-medium leading-none text-muted-foreground'
          >
            {tc('appSidebar.workspaceInvite.inviteViaEmail')}
          </label>
          <div className='flex flex-col gap-3 sm:flex-row'>
            <input
              id='workspace-invite-emails'
              type='text'
              value={emailsInput}
              onChange={event => setEmailsInput(event.target.value)}
              placeholder={t('appSidebar.workspaceInvite.emailsPlaceholder')}
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
              {isInviting
                ? tc('appSidebar.workspaceInvite.inviting')
                : tc('appSidebar.workspaceInvite.invite')}
            </button>
          </div>
        </div>

        <div className='my-5 h-px bg-border' />

        <div className='space-y-3'>
          <p className='text-[15px] font-medium leading-none text-muted-foreground'>
            {tc('appSidebar.workspaceInvite.inviteViaLink')}
          </p>
          <div className='flex gap-1.5'>
            <div className='flex h-10 min-w-0 flex-1 items-center rounded-[7px] bg-muted px-3.5 text-[15px] font-semibold text-foreground'>
              <span className='truncate'>{inviteUrl}</span>
            </div>
            <button
              type='button'
              aria-label={
                copied
                  ? tc('appSidebar.workspaceInvite.linkCopiedAriaLabel')
                  : tc('appSidebar.workspaceInvite.copyLinkAriaLabel')
              }
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
      </form>
    </Dialog>
  );
};

export default WorkspaceInviteDialog;
