import React, { useMemo, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import {
  BulkTicketMode,
  type BulkTicketItemInput,
  type ExistingParentTicket,
} from '@xyne/shared';
import { apiInstance } from '../../../services/clients/apiClient';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { RadioGroup, Radio } from '../../ui/RadioGroup/RadioGroup';

interface BulkCreateTicketsModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  projectId: string;
  boardId?: string;
  boardName?: string | undefined;
  mode?: BulkTicketMode;
  parentTitle?: string;
  subTitleTitles?: string[];
  subDescriptions?: string[];
  clientRowIds?: string[];
  existingParentTicket?: ExistingParentTicket;
  sourceMessageId?: string;
  sourceConversationId?: string;
  onTicketCreated?: () => void;
}

interface BulkTicketResponse {
  parentTicketId?: string;
  enqueuedSubTickets: number;
  failedSubTickets?: number;
  failedTitles?: string[];
}

const MAX_BULK_TICKETS = 100;

export const BulkCreateTicketsModal: React.FC<BulkCreateTicketsModalProps> = ({
  isOpen,
  onClose,
  channelId,
  projectId,
  boardId,
  boardName,
  mode: initialMode,
  parentTitle: initialParentTitle,
  subTitleTitles: initialSubTitles,
  subDescriptions: initialSubDescriptions,
  clientRowIds: initialClientRowIds,
  existingParentTicket,
  sourceMessageId,
  sourceConversationId,
  onTicketCreated,
}) => {
  const [mode, setMode] = useState<BulkTicketMode>(
    initialMode ?? (existingParentTicket ? BulkTicketMode.PARENT_SUB : BulkTicketMode.ALL_PARENTS),
  );
  const [parentTitle, setParentTitle] = useState(initialParentTitle ?? '');
  const [parentDescription, setParentDescription] = useState('');
  const [ticketText, setTicketText] = useState(
    initialSubTitles?.join('\n') ?? '',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<BulkTicketResponse | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode ?? (existingParentTicket ? BulkTicketMode.PARENT_SUB : BulkTicketMode.ALL_PARENTS));
      setParentTitle(initialParentTitle ?? '');
      setTicketText(initialSubTitles?.join('\n') ?? '');
      setResult(null);
    }
  }, [isOpen, initialMode, initialParentTitle, initialSubTitles, existingParentTicket]);

  const parsedItems = useMemo<BulkTicketItemInput[]>(() => {
    return ticketText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map((title, index) => ({
        title,
        channelId,
        projectId,
        ...(boardId ? { boardId } : {}),
        clientRowId: initialClientRowIds?.[index] ?? uuidv4(),
        ...(initialSubDescriptions?.[index]
          ? { description: initialSubDescriptions[index] }
          : {}),
      }));
  }, [ticketText, channelId, projectId, boardId, initialClientRowIds, initialSubDescriptions]);

  const canSubmit = useMemo(() => {
    if (parsedItems.length === 0 || parsedItems.length > MAX_BULK_TICKETS) return false;
    if (mode === BulkTicketMode.PARENT_SUB && !existingParentTicket && !parentTitle.trim()) return false;
    return true;
  }, [parsedItems, mode, parentTitle, existingParentTicket]);

  const handleClose = () => {
    if (isSubmitting) return;
    setTicketText('');
    setParentTitle('');
    setParentDescription('');
    setResult(null);
    setMode(BulkTicketMode.ALL_PARENTS);
    onClose();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setResult(null);

    try {
      const payload: Record<string, unknown> = {
        mode,
        subTickets: parsedItems,
        channelId,
        projectId,
        ...(boardId ? { boardId } : {}),
        ...(sourceConversationId ? { sourceConversationId } : {}),
        ...(sourceMessageId ? { sourceMessageId } : {}),
      };

      if (mode === BulkTicketMode.PARENT_SUB) {
        if (existingParentTicket) {
          payload.existingParentTicketId = existingParentTicket.id;
        } else {
          payload.parent = {
            title: parentTitle.trim(),
            description: parentDescription.trim(),
            channelId,
            projectId,
            ...(boardId ? { boardId } : {}),
            clientRowId: uuidv4(),
          };
        }
      }

      const { data } = await apiInstance.post<BulkTicketResponse>(
        '/tickets/bulk-from-message',
        payload,
      );

      setResult(data);

      if (data.failedSubTickets && data.failedSubTickets > 0) {
        toast.warning('Partial success', {
          description: `${data.enqueuedSubTickets} queued, ${data.failedSubTickets} failed: ${data.failedTitles?.join(', ')}`,
        });
      } else {
        toast.success(`${data.enqueuedSubTickets} ticket${data.enqueuedSubTickets === 1 ? '' : 's'} queued for creation.`);
      }

      if (onTicketCreated) {
        onTicketCreated();
      }
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to queue bulk ticket creation.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const showParentSection = mode === BulkTicketMode.PARENT_SUB && !existingParentTicket;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Create tickets in bulk'
      description={boardName ? `Board: ${boardName}` : undefined}
      className='max-w-2xl'
    >
      <div className='p-6 space-y-6'>
        {result ? (
          <div className='space-y-4'>
            <div className='rounded-lg bg-green-50 dark:bg-green-950/30 p-4 text-green-900 dark:text-green-100'>
              <p className='font-medium'>Batch queued successfully</p>
              <p className='text-sm mt-1'>
                {result.enqueuedSubTickets} ticket{result.enqueuedSubTickets === 1 ? '' : 's'} will be created in the
                background.
              </p>
              {result.parentTicketId && (
                <p className='text-sm mt-1'>Parent ticket id: {result.parentTicketId}</p>
              )}
            </div>
            <div className='flex justify-end'>
              <Button onClick={handleClose}>Close</Button>
            </div>
          </div>
        ) : (
          <>
            {!initialMode && !existingParentTicket && (
              <RadioGroup
                label='Creation mode'
                value={mode}
                onChange={value => setMode(value as BulkTicketMode)}
              >
                <Radio
                  value={BulkTicketMode.ALL_PARENTS}
                  subtext='Every line becomes its own ticket.'
                >
                  Independent tickets
                </Radio>
                <Radio
                  value={BulkTicketMode.PARENT_SUB}
                  subtext='Every line becomes a sub-ticket of the parent below.'
                >
                  Sub-tickets under a parent
                </Radio>
              </RadioGroup>
            )}

            {existingParentTicket && (
              <div className='rounded-lg border p-4 bg-muted/40'>
                <p className='text-sm font-medium'>Existing parent ticket</p>
                <p className='text-sm text-muted-foreground mt-1'>
                  Sub-tickets will be linked to ticket {existingParentTicket.id}
                  {existingParentTicket.xyneId ? ` (${existingParentTicket.xyneId})` : ''}
                </p>
              </div>
            )}

            {showParentSection && (
              <div className='space-y-3 rounded-lg border p-4 bg-muted/40'>
                <p className='text-sm font-medium'>Parent ticket</p>
                <Input
                  placeholder='Parent ticket title'
                  value={parentTitle}
                  onChange={e => setParentTitle(e.target.value)}
                />
                <Textarea
                  placeholder='Parent ticket description (optional)'
                  value={parentDescription}
                  onChange={e => setParentDescription(e.target.value)}
                  className='min-h-[60px]'
                />
              </div>
            )}

            <div className='space-y-2'>
              <label className='text-sm font-medium' htmlFor='bulk-ticket-text'>
                {mode === BulkTicketMode.PARENT_SUB ? 'Sub-tickets' : 'Tickets'}
              </label>
              <Textarea
                id='bulk-ticket-text'
                placeholder={`Enter one ticket title per line, e.g.\nFix login error\nUpdate onboarding copy\nInvestigate latency spike`}
                value={ticketText}
                onChange={e => setTicketText(e.target.value)}
                className='min-h-[160px] font-mono text-sm'
              />
              <p className='text-xs text-muted-foreground flex items-center justify-between'>
                <span>
                  {parsedItems.length} ticket{parsedItems.length === 1 ? '' : 's'} parsed
                </span>
                <span>Maximum {MAX_BULK_TICKETS}</span>
              </p>
            </div>

            <div className='flex items-center justify-end gap-3 pt-2'>
              <Button variant='outline' onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={!canSubmit || isSubmitting}
                loading={isSubmitting}
              >
                {isSubmitting
                  ? 'Queuing...'
                  : `Create ${parsedItems.length} ticket${parsedItems.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};
