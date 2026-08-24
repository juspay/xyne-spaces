import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Check, Pencil, Trash2 } from 'lucide-react';
import type { EmailSignature } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import Avatar from '../../../ui/Avatar/Avatar';
import { UserSelector } from '../../../Tickets/CreateTicketModal/UserSelector';
import { DeskIntegrationCard } from '../../DeskIntegrationCard/DeskIntegrationCard';
import { SlackDeskIntegrationCard } from '../../DeskIntegrationCard/SlackDeskIntegrationCard';
import { AppDeskIntegrationCard } from '../../DeskIntegrationCard/AppDeskIntegrationCard';
import { SocialMediaDeskIntegrationCard } from '../../DeskIntegrationCard/SocialMediaDeskIntegrationCard';
import { InlineSignatureEditor } from '../InlineSignatureEditor';
import { Switch } from '../../../ui/Switch';
import { matchesUserQuery } from '../../../../utils/userDisplayName';
import { useUsers } from '../../../../hooks/useUsers';
import { useZero } from '../../../../hooks/useZero';
import { mutators } from '../../../../zero/mutators';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';
import SignatureIcon from '../../../icons/SignatureIcon';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

/** Matches `EmailComposer` — when not `'false'`, default signature is auto-appended to replies. */
export const SIGNATURE_AUTO_APPEND_STORAGE_KEY = 'signature-auto-append-enabled';

/** Max CC picker rows — avoids rendering unbounded user lists in large orgs. */
const CC_USER_RESULT_LIMIT = 50;

function filterUsersByQuery(
  users: ReadonlyArray<{ id: string; name: string; email: string; displayName?: string | null }>,
  query: string,
) {
  if (!query.trim()) return [];
  return users.filter(u => matchesUserQuery(u, query));
}

interface InboxTabProps {
  channelId: string;
  form: DeskSettingsForm;
  signatures: EmailSignature[] | undefined;
}

export const InboxTab: React.FC<InboxTabProps> = ({ channelId, form, signatures }) => {
  const allUsers = useUsers();
  const zero = useZero();
  const {
    canManage,
    isEmail,
    isSlack,
    isApp,
    isSocial,
    ownerId,
    setOwner,
    sendAsAlias,
    setSendAsAlias,
    sendAsAliasError,
    ccEmails,
    setCcEmails,
    twoStepSend,
    setTwoStepSend,
    autoMergeEmails,
    setAutoMergeEmails,
    appWebhookDeliveryEnabled,
    setAppWebhookDeliveryEnabled,
  } = form;

  const [ccInputValue, setCcInputValue] = useState('');
  const [ccHighlightIndex, setCcHighlightIndex] = useState(0);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [editingSignature, setEditingSignature] = useState<EmailSignature | undefined>();
  const [signatureAutoAppendEnabled, setSignatureAutoAppendEnabled] = useState(
    () => localStorage.getItem(SIGNATURE_AUTO_APPEND_STORAGE_KEY) !== 'false',
  );
  const signatureModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (signatureModalOpen) {
      signatureModalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [signatureModalOpen]);

  const addCcEmail = (email: string) => {
    if (!email || ccEmails.includes(email)) return;
    setCcEmails(prev => [...prev, email]);
    setCcInputValue('');
    setCcHighlightIndex(0);
  };

  const ccUserMatches = filterUsersByQuery(allUsers ?? [], ccInputValue);
  const ccUserMatchesVisible = ccUserMatches.slice(0, CC_USER_RESULT_LIMIT);
  const ccUserMatchesTruncated = ccUserMatches.length > CC_USER_RESULT_LIMIT;

  return (
    <>
      {isEmail && <DeskIntegrationCard channelId={channelId} canManage={canManage} />}
      {isSlack && <SlackDeskIntegrationCard channelId={channelId} canManage={canManage} />}
      {isApp && <AppDeskIntegrationCard channelId={channelId} canManage={canManage} />}
      {isSocial && <SocialMediaDeskIntegrationCard channelId={channelId} canManage={canManage} />}

      <div className='flex flex-col gap-[16px]'>
        <div className='flex flex-col gap-[4px]'>
          <div className='text-desk-label'>Inbox Owner</div>
          <div className='text-desk-helper'>
            {isEmail
              ? 'This user will be used to create email tickets in this channel'
              : 'This user will be used to create tickets in this channel'}
          </div>
        </div>
        <fieldset
          disabled={!canManage}
          className={`w-full max-w-[300px] border-0 p-0 m-0 min-w-0 ${!canManage ? 'opacity-50' : ''}`}
        >
          <UserSelector
            selectedUserId={ownerId || null}
            onUserSelect={userId => {
              if (userId) setOwner(userId);
            }}
            channelId={channelId}
          />
        </fieldset>
      </div>

      {isEmail && (
        <div className='flex flex-col gap-[16px]'>
          <div className='flex flex-col gap-[4px]'>
            <div className='text-desk-label'>Send-as alias</div>
            <div className='text-desk-helper w-full max-w-[500px]'>
              {canManage ? (
                <>
                  Use this as the From address for outbound replies. Ideal for aliases like
                  support@yourcompany.com. Leave blank to use the connected mailbox.
                </>
              ) : (
                <>
                  Outbound replies on this desk are sent from this address. Only the desk owner or a
                  channel admin can change it.
                </>
              )}
            </div>
          </div>
          <input
            type='text'
            value={sendAsAlias}
            onChange={e => setSendAsAlias(e.target.value)}
            placeholder='support@yourcompany.com'
            readOnly={!canManage}
            disabled={!canManage}
            aria-invalid={!!sendAsAliasError}
            className={`h-[36px] w-full max-w-[300px] rounded-[10px] border bg-background px-[14px] py-[10px] text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 read-only:cursor-default read-only:bg-muted/40 read-only:focus:ring-0 ${
              sendAsAliasError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-border focus:ring-desk-accent'
            }`}
            data-track-category='DeskSettings'
            data-track-name='SendAsAliasInput'
          />
          {sendAsAliasError && (
            <p className='text-[12px] leading-[120%] text-red-500'>{sendAsAliasError}</p>
          )}
        </div>
      )}

      {isEmail && (
        <div className='flex flex-col gap-[16px]'>
          <div className='flex flex-col gap-[4px]'>
            <div className='text-desk-label'>Default CC</div>
            <div className='text-desk-helper'>
              Pre-fill CC recipients for new emails from this desk.
            </div>
          </div>
          <div className='relative'>
            <div
              className={`flex w-full items-center gap-1.5 overflow-x-auto rounded-[10px] border border-border bg-background p-[6px] text-sm shadow-sm scrollbar-none focus-within:ring-1 focus-within:ring-desk-accent ${
                !canManage ? 'cursor-not-allowed bg-muted/40 opacity-60' : ''
              }`}
            >
              {ccEmails.map((email, idx) => (
                <div
                  key={`${email}-${idx}`}
                  className='inline-flex shrink-0 items-center gap-[4px] whitespace-nowrap rounded-[6px] bg-desk-accent-subtle py-[2px] pl-[6px] pr-[4px]'
                >
                  <span className='text-[13px] font-medium leading-[18px] tracking-[-0.2px] text-desk-accent-foreground font-medium'>
                    {email}
                  </span>
                  <button
                    type='button'
                    onClick={() => setCcEmails(prev => prev.filter((_, i) => i !== idx))}
                    disabled={!canManage}
                    className='text-desk-accent-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                    data-track-category='DeskSettings'
                    data-track-name='RemoveCcEmail'
                    aria-label={`Remove ${email}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <input
                type='text'
                value={ccInputValue}
                onChange={e => {
                  setCcInputValue(e.target.value);
                  setCcHighlightIndex(0);
                }}
                data-track-category='DeskSettings'
                data-track-name='CcEmailInput'
                onKeyDown={e => {
                  const hasDropdown = ccInputValue.length >= 1 && ccUserMatchesVisible.length > 0;

                  if (hasDropdown && e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCcHighlightIndex(i => Math.min(i + 1, ccUserMatchesVisible.length - 1));
                    return;
                  }
                  if (hasDropdown && e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCcHighlightIndex(i => Math.max(i - 1, 0));
                    return;
                  }
                  if (hasDropdown && e.key === 'Enter') {
                    e.preventDefault();
                    const user = ccUserMatchesVisible[ccHighlightIndex];
                    if (user) addCcEmail(user.email);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
                    e.preventDefault();
                    addCcEmail(ccInputValue.trim());
                  }
                  if (e.key === 'Backspace' && ccInputValue === '' && ccEmails.length > 0) {
                    setCcEmails(prev => prev.slice(0, -1));
                  }
                }}
                placeholder={ccEmails.length === 0 ? 'Add email recipients' : ''}
                readOnly={!canManage}
                disabled={!canManage}
                className='min-w-[80px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-desk-helper disabled:cursor-not-allowed'
              />
            </div>

            {ccInputValue.length >= 1 && (
              <div className='absolute left-0 top-full z-10 mt-1.5 w-full max-w-[468px] rounded-[12px] border border-border bg-background shadow-md max-h-[200px] overflow-y-auto py-1'>
                {ccUserMatchesVisible.map((user, idx) => {
                  const isSelected = ccEmails.includes(user.email);
                  const isHighlighted = idx === ccHighlightIndex;
                  return (
                    <button
                      key={user.id}
                      type='button'
                      className={`flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition-colors ${
                        isHighlighted ? 'bg-muted/60' : 'hover:bg-muted/60'
                      }`}
                      data-track-category='DeskSettings'
                      data-track-name='SelectCcUser'
                      onMouseEnter={() => setCcHighlightIndex(idx)}
                      onClick={() => {
                        if (!isSelected) addCcEmail(user.email);
                      }}
                    >
                      <Avatar
                        userId={user.id}
                        size='sm'
                        showActiveStatus={false}
                        className='!size-6 shrink-0 !rounded-full'
                      />
                      <span className='min-w-0 flex-1 truncate text-[13px] leading-[18px]'>
                        <span className='font-medium text-foreground'>{user.name}</span>
                        <span className='text-desk-helper'> · {user.email}</span>
                      </span>
                      {isSelected && <Check size={16} className='shrink-0 text-foreground' />}
                    </button>
                  );
                })}
                {ccUserMatches.length === 0 && (
                  <div className='px-3 py-2 text-[13px] text-desk-helper italic'>
                    No matching users
                  </div>
                )}
                {ccUserMatchesTruncated && (
                  <div className='px-3 py-2 text-xs text-desk-helper'>
                    {ccUserMatches.length - CC_USER_RESULT_LIMIT} more results — type to refine
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {isApp && (
        <div className='flex items-start justify-between gap-4'>
          <div className='flex flex-col gap-[4px]'>
            <div className='text-desk-label'>Send replies to app webhook</div>
            <div className='text-desk-helper w-full max-w-[500px]'>
              Forward every reply to the app webhook, and accept the reply only once the webhook
              responds with 200. Turn this off if the app does not consume replies.
            </div>
          </div>
          <Switch
            variant='desk'
            checked={appWebhookDeliveryEnabled}
            onCheckedChange={setAppWebhookDeliveryEnabled}
            disabled={!canManage}
            aria-label='Toggle sending replies to the app webhook'
          />
        </div>
      )}

      {isEmail && (
        <div className='flex items-start justify-between gap-4'>
          <div className='flex flex-col gap-[4px]'>
            <div className='text-desk-label'>Two-step send</div>
            <div className='text-desk-helper w-full max-w-[500px]'>
              Show a review step before an email is sent. When on, clicking Send opens a
              confirmation card so you can double-check recipients and content before it goes out.
            </div>
          </div>
          <Switch
            variant='desk'
            checked={twoStepSend}
            onCheckedChange={setTwoStepSend}
            disabled={!canManage}
            aria-label='Toggle two-step send'
          />
        </div>
      )}

      {isEmail && (
        <div className='flex items-start justify-between gap-4'>
          <div className='flex flex-col gap-[4px]'>
            <div className='text-desk-label'>Auto-merge similar emails</div>
            <div className='text-desk-helper w-full max-w-[500px]'>
              Merge emails with the same subject and sender into one ticket, or create separate
              tickets for each thread.
            </div>
          </div>
          <Switch
            variant='desk'
            checked={autoMergeEmails}
            onCheckedChange={setAutoMergeEmails}
            disabled={!canManage}
            aria-label='Toggle auto-merge similar emails'
          />
        </div>
      )}

      {isEmail && (
        <div className='flex flex-col gap-[16px] rounded-[16px] bg-muted/60 p-[6px] dark:bg-muted/20'>
          <div className='flex items-start justify-between gap-4 py-[8px]'>
            <div className='flex flex-col gap-[4px] px-[6px]'>
              <div className='text-desk-label'>Email Signatures</div>
              <div className='text-desk-helper'>
                Appended to every email reply you send from Xyne Desk.
              </div>
            </div>
            <Switch
              variant='desk'
              checked={signatureAutoAppendEnabled}
              onCheckedChange={checked => {
                setSignatureAutoAppendEnabled(checked);
                try {
                  localStorage.setItem(SIGNATURE_AUTO_APPEND_STORAGE_KEY, String(checked));
                } catch {
                  // Safari private mode / quota exceeded — preference stays in session only
                }
              }}
            />
          </div>

          {signatureModalOpen && (
            <div ref={signatureModalRef}>
              <InlineSignatureEditor
                initial={editingSignature}
                onSave={data => {
                  const now = Date.now();
                  if (data.id) {
                    zero.mutate(
                      mutators.emailSignature.update({
                        id: data.id,
                        name: data.name,
                        content: data.content,
                        timestamp: now,
                      }),
                    );
                  } else {
                    const newId = uuidv4();
                    const isFirstSignature = !signatures || signatures.length === 0;
                    zero.mutate(
                      mutators.emailSignature.create({
                        id: newId,
                        name: data.name,
                        content: data.content,
                        timestamp: now,
                      }),
                    );
                    if (isFirstSignature) {
                      zero.mutate(
                        mutators.emailSignature.setDefault({
                          id: newId,
                          timestamp: now,
                        }),
                      );
                    }
                  }
                  setSignatureModalOpen(false);
                  setEditingSignature(undefined);
                }}
                onCancel={() => {
                  setSignatureModalOpen(false);
                  setEditingSignature(undefined);
                }}
              />
            </div>
          )}
          {(!signatures || signatures.length === 0) && !signatureModalOpen ? (
            <div className='relative min-h-[150px] rounded-[16px] bg-background flex items-center justify-center'>
              <svg
                className='absolute inset-0 w-full h-full pointer-events-none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect
                  x='0.5'
                  y='0.5'
                  width='calc(100% - 1px)'
                  height='calc(100% - 1px)'
                  rx='16'
                  ry='16'
                  fill='none'
                  stroke='var(--desk-border)'
                  strokeWidth='1'
                  strokeDasharray='5 5'
                />
              </svg>

              <button
                type='button'
                className='inline-flex h-[32px] items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-desk-label text-foreground shadow-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50'
                disabled={!signatureAutoAppendEnabled}
                onClick={() => {
                  setEditingSignature(undefined);
                  setSignatureModalOpen(true);
                }}
                data-track-category='DeskSettings'
                data-track-name='AddSignature'
              >
                <Plus size={14} />
                <span>Add Signature</span>
              </button>
            </div>
          ) : signatures && signatures.length > 0 && !signatureModalOpen ? (
            <div
              className={`flex flex-col gap-[4px] transition-opacity duration-300 ${signatureAutoAppendEnabled ? 'opacity-100' : 'opacity-40'}`}
            >
              <div className='flex flex-col max-h-[120px] rounded-[14px] p-[6px] gap-[6px] border border-border bg-background overflow-y-auto shadow-sm scrollbar-none'>
                {(signatures ?? []).map(sig => (
                  <div
                    key={sig.id}
                    className='group flex items-center justify-between h-[32px] py-[8px] px-[10px] rounded-[10px] hover:bg-muted/60 transition-colors hover:cursor-pointer'
                  >
                    <div className='flex items-center gap-2 min-w-0'>
                      <SignatureIcon className='text-muted-foreground shrink-0' />
                      <span className='text-desk-label truncate'>{sig.name}</span>
                      {sig.isDefault && (
                        <span className='ml-2 shrink-0 rounded-full bg-desk-accent-badge px-2 py-0.5 text-[11px] font-medium text-desk-accent-foreground'>
                          Default
                        </span>
                      )}
                    </div>
                    <div className='flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0'>
                      {!sig.isDefault && (
                        <button
                          type='button'
                          onClick={() =>
                            zero.mutate(
                              mutators.emailSignature.setDefault({
                                id: sig.id,
                                timestamp: Date.now(),
                              }),
                            )
                          }
                          className='text-[13px] font-medium leading-[120%] tracking-[-0.1px] text-foreground'
                          data-track-category='DeskSettings'
                          data-track-name='SetDefaultSignature'
                        >
                          Set as default
                        </button>
                      )}
                      <button
                        type='button'
                        onClick={() => {
                          setEditingSignature(sig);
                          setSignatureModalOpen(true);
                        }}
                        className='text-desk-muted transition-colors hover:text-foreground'
                        title='Edit signature'
                        aria-label='Edit signature'
                        data-track-category='DeskSettings'
                        data-track-name='EditSignature'
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type='button'
                        onClick={() => zero.mutate(mutators.emailSignature.delete({ id: sig.id }))}
                        className='text-desk-muted transition-colors hover:text-red-500'
                        title='Delete signature'
                        aria-label='Delete signature'
                        data-track-category='DeskSettings'
                        data-track-name='DeleteSignature'
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className='flex justify-end'>
                <button
                  type='button'
                  className='inline-flex h-[32px] items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-desk-label text-foreground shadow-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50'
                  disabled={!signatureAutoAppendEnabled}
                  onClick={() => {
                    setEditingSignature(undefined);
                    setSignatureModalOpen(true);
                  }}
                  data-track-category='DeskSettings'
                  data-track-name='AddSignature'
                >
                  <Plus size={14} />
                  <span>Add Signature</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
};
