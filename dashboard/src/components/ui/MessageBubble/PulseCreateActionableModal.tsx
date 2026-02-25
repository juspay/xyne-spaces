import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { callService } from '../../../services/Call/callService';
import { conversationService } from '../../../services/Chat/conversationService';
import { type PulseItem, type PulseMerchant } from '../../../utils/parsePulseMarkdown';
import { SearchUser } from '../SearchUser/SearchUser';
import { useUsers } from '../../../hooks/useUsers';
import type { User } from '@xyne/shared';

export type { PulseItem };

interface PulseCreateActionableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  callId: string;
  item: PulseItem;
  merchant: PulseMerchant | null;
  conversationId: string;
  messageId: string;
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

      await callService.createPulseActionable(callId, {
        title: title.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(assigneeEmail && { assignee: assigneeEmail }),
        ...(merchant?.name && { merchantName: merchant.name }),
        ...(merchant?.orgId && { orgId: merchant.orgId }),
        merchantId: merchant?.merchantId ?? null,
        productId: merchant?.productId ?? null,
      });

      await conversationService.markPulseItemAsSent(conversationId, messageId, item.itemId);

      toast.success('Pulse actionable created successfully');
      onSuccess?.();
      onClose();
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
      onKeyDown={e => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className='bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden'
        role='dialog'
        aria-modal='true'
        aria-label='Create Pulse Actionable'
        tabIndex={-1}
      >
        {/* Header */}
        <div className='flex items-center gap-2 px-5 py-4 border-b border-gray-100'>
          <span className='text-lg'>⚡</span>
          <h2 className='text-base font-semibold text-gray-900 flex-1'>Create Pulse Actionable</h2>
          <button
            type='button'
            onClick={onClose}
            className='text-gray-400 hover:text-gray-600 transition-colors rounded-md p-1 hover:bg-gray-100'
            aria-label='Close modal'
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={e => void handleSubmit(e)} className='px-5 py-4 flex flex-col gap-4'>
          {/* Merchant (read-only) */}
          {merchant?.name && (
            <div className='flex flex-col gap-1'>
              <label
                htmlFor='pulse-merchant'
                className='text-xs font-medium text-gray-600 uppercase tracking-wide'
              >
                Merchant
              </label>
              <div
                id='pulse-merchant'
                className='border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-gray-50 select-none cursor-default'
              >
                {merchant.name}
              </div>
            </div>
          )}

          {/* Title */}
          <div className='flex flex-col gap-1'>
            <label
              htmlFor='pulse-title'
              className='text-xs font-medium text-gray-600 uppercase tracking-wide'
            >
              Title <span className='text-red-500'>*</span>
            </label>
            <input
              id='pulse-title'
              type='text'
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={submitting}
              required
              className='border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-60'
              placeholder='Actionable title'
            />
          </div>

          {/* Description */}
          <div className='flex flex-col gap-1'>
            <label
              htmlFor='pulse-description'
              className='text-xs font-medium text-gray-600 uppercase tracking-wide'
            >
              Description
            </label>
            <textarea
              id='pulse-description'
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={submitting}
              rows={3}
              className='border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none disabled:opacity-60'
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
              disabled={submitting}
              className='px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition disabled:opacity-50'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={submitting || !title.trim()}
              className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5'
            >
              {submitting ? (
                <>
                  <span className='w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block' />
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
