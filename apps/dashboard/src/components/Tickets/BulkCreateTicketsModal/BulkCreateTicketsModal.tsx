import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import {
  BulkTicketMode,
  type BulkTicketItemInput,
  type CreateBulkTicketResponse,
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
  boardId: string;
  boardName?: string | undefined;
}

const MAX_BULK_TICKETS = 100;

export const BulkCreateTicketsModal: React.FC<BulkCreateTicketsModalProps> = ({
  isOpen,
  onClose,
  channelId,
  projectId,
  boardId,
  boardName,
}) => {
  const [mode, setMode] = useState<BulkTicketMode>(BulkTicketMode.ALL_PARENTS);
  const [parentTitle, setParentTitle] = useState('');
  const [parentDescription, setParentDescription] = useState('');
  const [ticketText, setTicketText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CreateBulkTicketResponse | null>(null);

  const parsedItems = useMemo<BulkTicketItemInput[]>(() => {
    return ticketText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(title => ({
        title,
        channelId,
        projectId,
        boardId,
        clientRowId: uuidv4(),
      }));
  }, [ticketText, channelId, projectId, boardId]);

  const canSubmit = useMemo(() => {
    if (parsedItems.length === 0 || parsedItems.length > MAX_BULK_TICKETS) return false;
    if (mode === BulkTicketMode.PARENT_SUB && !parentTitle.trim()) return false;
    return true;
  }, [parsedItems, mode, parentTitle]);

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
      const payload: {
        mode: BulkTicketMode;
        subTickets: BulkTicketItemInput[];
        parent?: BulkTicketItemInput;
      } = {
        mode,
        subTickets: parsedItems,
      };

      if (mode === BulkTicketMode.PARENT_SUB) {
        payload.parent = {
          title: parentTitle.trim(),
          description: parentDescription.trim(),
          channelId,
          projectId,
          boardId,
          clientRowId: uuidv4(),
        };
      }

      const { data } = await apiInstance.post<CreateBulkTicketResponse>(
        '/tickets/bulk-from-message',
        payload,
      );

      setResult(data);
      toast.success(`${data.queued} ticket${data.queued === 1 ? '' : 's'} queued for creation.`);
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to queue bulk ticket creation.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

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
                {result.queued} ticket{result.queued === 1 ? '' : 's'} will be created in the
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
            <RadioGroup
              label='Creation mode'
              value={mode}
              onChange={value => setMode(value as BulkTicketMode)}
            >
              <Radio value={BulkTicketMode.ALL_PARENTS} subtext='Every line becomes its own ticket.'>
                Independent tickets
              </Radio>
              <Radio
                value={BulkTicketMode.PARENT_SUB}
                subtext='Every line becomes a sub-ticket of the parent below.'
              >
                Sub-tickets under a parent
              </Radio>
            </RadioGroup>

            {mode === BulkTicketMode.PARENT_SUB && (
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
                Tickets
              </label>
              <Textarea
                id='bulk-ticket-text'
                placeholder={`Enter one ticket title per line, e.g.\nFix login error\nUpdate onboarding copy\nInvestigate latency spike`}
                value={ticketText}
                onChange={e => setTicketText(e.target.value)}
                className='min-h-[160px] font-mono text-sm'
              />
              <p className='text-xs text-muted-foreground flex items-center justify-between'>
                <span>{parsedItems.length} ticket{parsedItems.length === 1 ? '' : 's'} parsed</span>
                <span>Maximum {MAX_BULK_TICKETS}</span>
              </p>
            </div>

            <div className='flex items-center justify-end gap-3 pt-2'>
              <Button variant='outline' onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting} loading={isSubmitting}>
                {isSubmitting ? 'Queuing...' : `Create ${parsedItems.length} ticket${parsedItems.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};
