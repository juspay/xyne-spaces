import { ReactElement } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawCloneRequests } from '@/hooks/useClawCloneRequests';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { DetailSection, EmptyPanel } from './detailTabUtils';

const CloneRequestsTab = ({ agent }: { agent: Agent }): ReactElement => {
  const {
    data: requests = [],
    isLoading,
    approve,
    reject,
  } = useClawCloneRequests(agent.id, agent.slug);
  const busyId = approve.variables?.id ?? reject.variables?.id;

  const resolve = async (request: (typeof requests)[number], decision: 'approve' | 'reject') => {
    try {
      if (decision === 'approve') {
        await approve.mutateAsync(request);
        toast.success('Clone request approved');
      } else {
        await reject.mutateAsync(request);
        toast.success('Clone request declined');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resolve clone request');
    }
  };

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      <DetailSection
        title='Clone requests'
        description='Review requests from people who want a personal copy of this agent.'
      >
        {isLoading ? (
          <div className='flex flex-col gap-2 rounded-lg border border-border p-4'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        ) : requests.length === 0 ? (
          <EmptyPanel
            title='No pending requests'
            description='New clone requests for this agent will appear here.'
          />
        ) : (
          <ul className='flex flex-col gap-2'>
            {requests.map(request => (
              <li
                key={request.id}
                className='flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3'
              >
                <div className='flex min-w-0 items-center gap-3'>
                  <Copy className='size-4 shrink-0 text-muted-foreground' />
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium text-foreground'>
                      {request.requesterName || request.requesterEmail || request.requesterId}
                    </p>
                    <p className='text-xs text-muted-foreground'>wants to clone this agent</p>
                  </div>
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    disabled={!!busyId}
                    loading={busyId === request.id && approve.isPending}
                    onClick={() => void resolve(request, 'approve')}
                    data-track-category='Claw Agents'
                    data-track-name='APPROVE_CLONE_REQUEST'
                  >
                    <Check className='size-4' /> Approve
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!!busyId}
                    loading={busyId === request.id && reject.isPending}
                    onClick={() => void resolve(request, 'reject')}
                    data-track-category='Claw Agents'
                    data-track-name='REJECT_CLONE_REQUEST'
                  >
                    <X className='size-4' /> Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
    </div>
  );
};

export default CloneRequestsTab;
