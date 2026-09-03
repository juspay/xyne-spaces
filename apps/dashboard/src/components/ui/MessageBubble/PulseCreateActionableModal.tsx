import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { callService } from '../../../services/Call/callService';
import { conversationService } from '../../../services/Chat/conversationService';
import { type PulseItem, type PulseMerchant } from '../../../utils/parsePulseMarkdown';
import { SearchUser } from '../SearchUser/SearchUser';
import { useUsers } from '../../../hooks/useUsers';
import type { User } from '@xyne/shared';

export type { PulseItem };

interface PulseOrg {
  id: string;
  name: string;
  orgId: string;
  merchantIds: string[];
}

interface PulseCreateActionableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  callId: string;
  item: PulseItem;
  merchant: PulseMerchant | null;
  conversationId: string;
  messageId: string;
  queuePosition?: { current: number; total: number };
}

export const PulseCreateActionableModal: React.FC<PulseCreateActionableModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  callId,
  item,
  merchant,
  conversationId,
  messageId,
  queuePosition,
}) => {
  const allUsers = useUsers();

  // Pre-select the user that matches the LLM-extracted assignee email
  const initialAssignee = useMemo<User[]>(() => {
    if (!item.assignee || item.assignee === 'unassigned') return [];
    const email = item.assignee.toLowerCase().trim();
    const match = allUsers.find(u => u.email?.toLowerCase() === email);
    return match ? [match] : [];
  }, [allUsers, item.assignee]);

  const [title, setTitle] = useState(item.content);
  const [description, setDescription] = useState('');
  const [selectedAssignees, setSelectedAssignees] = useState<User[]>(initialAssignee);
  const [submitting, setSubmitting] = useState(false);

  // Merchant edit state
  const [localMerchant, setLocalMerchant] = useState<PulseMerchant | null>(merchant);
  const [isEditingMerchant, setIsEditingMerchant] = useState(false);
  const [merchantSearch, setMerchantSearch] = useState('');
  const [orgs, setOrgs] = useState<PulseOrg[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus input when dropdown opens safely without triggering jsx-a11y/no-autofocus
  useEffect(() => {
    if (isEditingMerchant) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isEditingMerchant]);

  const fetchOrgs = async () => {
    if (orgs.length > 0) return;
    setLoadingOrgs(true);
    try {
      const result = await callService.fetchPulseOrgs();
      setOrgs(result);
    } catch {
      toast.error('Failed to load organisation list');
    } finally {
      setLoadingOrgs(false);
    }
  };

  const handleEditMerchantClick = () => {
    setIsEditingMerchant(true);
    setMerchantSearch('');
    void fetchOrgs();
  };

  const handleSelectOrg = (org: PulseOrg) => {
    // Retain original id for updating the frontmatter via the localMerchantId reference
    if (localMerchant) {
      setLocalMerchant({
        ...localMerchant,
        name: org.name,
        orgId: org.orgId,
      });
    }
    setIsEditingMerchant(false);
  };

  if (!isOpen) return null;

  // Only allow a single assignee — replace rather than append
  const handleAssigneeChange = (users: User[]) => {
    // SearchUser appends; keep only the latest selection
    const latest = users.at(-1);
    setSelectedAssignees(latest ? [latest] : []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      const assigneeEmail = selectedAssignees[0]?.email ?? '';

      // If merchant was changed, persist to the chat transcript frontmatter
      if (localMerchant && merchant && localMerchant.orgId !== merchant.orgId) {
        // Run in background so we don't block submit, but it will propagate to UI
        void conversationService.updatePulseMerchant(conversationId, messageId, {
          merchantId: localMerchant.id,
          orgId: localMerchant.orgId,
          orgName: localMerchant.name,
        });
      }

      await callService.createPulseActionable(callId, {
        title: title.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(assigneeEmail && { assignee: assigneeEmail }),
        ...(localMerchant?.name && { merchantName: localMerchant.name }),
        ...(localMerchant?.orgId && { orgId: localMerchant.orgId }),
        // For ticket create, if org changed we might not have the correct product ID local here yet
        // until backend resolves it in updatePulseMerchant. But we pass what we have.
        merchantId: localMerchant?.merchantId ?? null,
        productId: localMerchant?.productId ?? null,
      });

      await conversationService.markPulseItemAsSent(conversationId, messageId, item.itemId);

      toast.success('Pulse actionable created successfully');
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create Pulse actionable');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'
      role='presentation'
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-track-category='MESSAGE'
      data-track-name='CLOSE_PULSE_MODAL_BACKDROP'
      onKeyDown={e => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className='bg-background rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden'
        role='dialog'
        aria-modal='true'
        aria-label='Create Pulse Actionable'
        tabIndex={-1}
      >
        {/* Header */}
        <div className='flex items-center gap-2 px-5 py-4 border-b border-border'>
          <span className='text-lg'>⚡</span>
          <h2 className='text-base font-semibold text-foreground flex-1'>
            {queuePosition && queuePosition.total > 1
              ? `Create Pulse Actionable (${queuePosition.current}/${queuePosition.total})`
              : 'Create Pulse Actionable'}
          </h2>
          <button
            type='button'
            onClick={onClose}
            data-track-category='MESSAGE'
            data-track-name='CLOSE_PULSE_MODAL'
            className='text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 hover:bg-accent'
            aria-label='Close modal'
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={e => void handleSubmit(e)} className='px-5 py-4 flex flex-col gap-4'>
          {/* Merchant (Editable) */}
          {localMerchant?.name && (
            <div className='flex flex-col gap-1 relative'>
              <label
                htmlFor='pulse-merchant'
                className='text-xs font-medium text-muted-foreground uppercase tracking-wide flex justify-between items-center'
              >
                <span>Merchant</span>
              </label>

              {!isEditingMerchant ? (
                <button
                  id='pulse-merchant'
                  type='button'
                  onClick={handleEditMerchantClick}
                  data-track-category='MESSAGE'
                  data-track-name='START_EDIT_PULSE_MERCHANT'
                  disabled={submitting}
                  className='border border-border rounded-lg px-3 py-2 text-sm text-foreground bg-muted hover:bg-accent transition-colors flex items-center justify-between text-left focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed w-full'
                >
                  <div className='flex items-center'>
                    <span>{localMerchant.name}</span>
                    {localMerchant.orgId !== merchant?.orgId && (
                      <span className='ml-2 text-[10px] text-action-primary font-medium px-1.5 py-0.5 bg-accent rounded-full'>
                        Changed
                      </span>
                    )}
                  </div>
                  <svg
                    xmlns='http://www.w3.org/2000/svg'
                    width='16'
                    height='16'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    className='text-muted-foreground ml-2 opacity-70 flex-shrink-0'
                  >
                    <path d='m6 9 6 6 6-6' />
                  </svg>
                </button>
              ) : (
                <div className='border border-border rounded-lg bg-background overflow-hidden relative z-10'>
                  <div className='p-2 border-b border-border bg-muted/50'>
                    <input
                      ref={searchInputRef}
                      type='text'
                      value={merchantSearch}
                      onChange={e => setMerchantSearch(e.target.value)}
                      placeholder='Search alternative organisation…'
                      className='w-full text-xs px-2 py-1.5 border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                    />
                  </div>
                  <div className='max-h-40 overflow-y-auto'>
                    {loadingOrgs ? (
                      <div className='px-3 py-4 text-xs text-muted-foreground text-center'>
                        Loading…
                      </div>
                    ) : orgs.filter(o =>
                        o.name.toLowerCase().includes(merchantSearch.toLowerCase().trim()),
                      ).length === 0 ? (
                      <div className='px-3 py-4 text-xs text-muted-foreground text-center'>
                        No matches found
                      </div>
                    ) : (
                      orgs
                        .filter(o =>
                          o.name.toLowerCase().includes(merchantSearch.toLowerCase().trim()),
                        )
                        .map(org => {
                          const isCurrentOrg = org.orgId === localMerchant.orgId;
                          return (
                            <button
                              key={org.orgId}
                              type='button'
                              onClick={() => handleSelectOrg(org)}
                              data-track-category='MESSAGE'
                              data-track-name='SELECT_PULSE_ORG'
                              className={`w-full text-left px-3 py-2 text-xs transition-colors border-none cursor-pointer ${
                                isCurrentOrg
                                  ? 'bg-accent text-action-primary font-medium'
                                  : 'bg-transparent text-foreground hover:bg-accent'
                              }`}
                            >
                              {org.name}
                            </button>
                          );
                        })
                    )}
                  </div>
                  <div className='p-2 border-t border-border bg-muted/30 flex justify-end'>
                    <button
                      type='button'
                      onClick={() => setIsEditingMerchant(false)}
                      data-track-category='MESSAGE'
                      data-track-name='CANCEL_EDIT_PULSE_MERCHANT'
                      className='text-xs text-muted-foreground hover:text-foreground'
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <div className='flex flex-col gap-1'>
            <label
              htmlFor='pulse-title'
              className='text-xs font-medium text-muted-foreground uppercase tracking-wide'
            >
              Title <span className='text-destructive'>*</span>
            </label>
            <input
              id='pulse-title'
              type='text'
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={submitting}
              required
              className='border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition disabled:opacity-60'
              placeholder='Actionable title'
            />
          </div>

          {/* Description */}
          <div className='flex flex-col gap-1'>
            <label
              htmlFor='pulse-description'
              className='text-xs font-medium text-muted-foreground uppercase tracking-wide'
            >
              Description
            </label>
            <textarea
              id='pulse-description'
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={submitting}
              rows={3}
              className='border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition resize-none disabled:opacity-60'
              placeholder='Add more context (optional)'
            />
          </div>

          {/* Assignee — SearchUser (single-select) */}
          <div className='flex flex-col gap-1'>
            <SearchUser
              selectedUsers={selectedAssignees}
              onUsersChange={handleAssigneeChange}
              placeholder='Search by name or email…'
              label='ASSIGNEE'
              hintText=''
              disabled={{ value: submitting }}
            />
          </div>

          {/* Footer buttons */}
          <div className='flex justify-end gap-2 pt-1'>
            <button
              type='button'
              onClick={onClose}
              data-track-category='MESSAGE'
              data-track-name='CANCEL_PULSE_MODAL'
              disabled={submitting}
              className='px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition disabled:opacity-50'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={submitting || !title.trim()}
              className='px-4 py-2 text-sm font-medium text-action-primary-foreground bg-action-primary hover:opacity-90 rounded-lg transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5'
            >
              {submitting ? (
                <>
                  <span className='w-3.5 h-3.5 border-2 border-action-primary-foreground border-t-transparent rounded-full animate-spin inline-block' />
                  Sending…
                </>
              ) : (
                'Create Actionable'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
