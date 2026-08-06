import { useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { clawErrorText } from '@/services/claw/clawRequest';
import { V2Dialog } from '../../create-v2/shared/V2Dialog';
import { BehaviourRow, BehaviourToggle } from '../behaviour/BehaviourRows';
import { DetailCard } from '../DetailPrimitives';
import {
  agentMemoryKey,
  agentMemoryStatusKey,
  clearAgentMemories,
  setAgentMemoryEnabled,
  type AgentMemoryStatus,
} from './agentMemoryService';

const APPROVAL_LABELS: Record<AgentMemoryStatus['memoryApprovalStrategy'], string> = {
  HUMAN_ONLY: 'Human review',
  EVALS_ONLY: 'Auto via evals',
  EVALS_THEN_HUMAN: 'Evals, then human',
};

interface MemoryManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  status: AgentMemoryStatus | undefined;
  memoryCount: number;
  canEdit: boolean;
}

export function MemoryManageDialog({
  open,
  onOpenChange,
  slug,
  status,
  memoryCount,
  canEdit,
}: MemoryManageDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const enabled = status?.memoryEnabled ?? false;

  const toggleEnabled = async (next: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await setAgentMemoryEnabled(slug, next);
      queryClient.setQueryData(agentMemoryStatusKey(slug), updated);
      toast.success(next ? 'Memory enabled' : 'Memory disabled');
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not change the memory setting'));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await clearAgentMemories(slug);
      void queryClient.invalidateQueries({ queryKey: agentMemoryKey(slug) });
      toast.success('All memories cleared');
      setConfirmClear(false);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not clear the memories'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={next => {
        setConfirmClear(false);
        onOpenChange(next);
      }}
      title='Memory'
      description='What this agent remembers between sessions.'
      testId='memory-manage-dialog'
      footer={
        <Button
          variant='ghost'
          onClick={() => onOpenChange(false)}
          className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: close memory dialog'
        >
          Done
        </Button>
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>
        When memory is on, each session is summarised by the nightly curator and the useful facts
        are recalled at the start of later sessions.
      </p>

      <DetailCard>
        <BehaviourRow
          title='Memory enabled'
          hint='Enrols this agent in the memory pipeline from its next session onwards.'
        >
          <BehaviourToggle
            checked={enabled}
            editable={canEdit}
            disabled={busy}
            label='Memory enabled'
            trackName='Agent detail v2: toggle memory'
            onChange={next => void toggleEnabled(next)}
          />
        </BehaviourRow>

        <BehaviourRow
          title='Approval'
          hint='How a curated memory gets accepted into the bank.'
          last
        >
          <span className='text-sm font-normal leading-5 text-foreground'>
            {APPROVAL_LABELS[status?.memoryApprovalStrategy ?? 'HUMAN_ONLY']}
          </span>
        </BehaviourRow>
      </DetailCard>

      {canEdit && (
        <section className='flex w-full flex-col gap-3'>
          <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
            Clear memories
          </span>
          <p className='text-sm font-normal leading-5 text-muted-foreground'>
            Deletes all {memoryCount} stored {memoryCount === 1 ? 'memory' : 'memories'} for this
            agent. This can&apos;t be undone.
          </p>
          {confirmClear ? (
            <div className='flex items-center gap-3'>
              <Button
                variant='ghost'
                onClick={() => setConfirmClear(false)}
                disabled={busy}
                className='h-auto rounded-xl px-3 py-2 text-sm'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: cancel clear memories'
              >
                Cancel
              </Button>
              <Button
                onClick={() => void clearAll()}
                loading={busy}
                className='h-auto rounded-xl bg-destructive px-3 py-2 text-sm text-destructive-foreground hover:bg-destructive/90'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: confirm clear memories'
              >
                Yes, clear everything
              </Button>
            </div>
          ) : (
            <Button
              variant='ghost'
              onClick={() => setConfirmClear(true)}
              disabled={busy || memoryCount === 0}
              className='h-auto w-fit rounded-xl px-3 py-2 text-sm text-destructive hover:bg-destructive/10'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: clear memories'
            >
              Clear all memories
            </Button>
          )}
        </section>
      )}
    </V2Dialog>
  );
}
