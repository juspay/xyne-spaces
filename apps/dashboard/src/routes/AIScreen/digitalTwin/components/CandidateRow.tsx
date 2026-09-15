import { ReactElement, ReactNode, useState } from 'react';
import {
  CheckTickCircle,
  MultipleCrossCancelCircle,
  MultipleCrossCancelDefault,
  PencilEdit,
  Spinner,
} from '@xyne/icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button/index';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { TruncatedTooltip } from '@/components/ui/Tooltip/TruncatedTooltip';
import { HighlightMatch } from '@/routes/AIScreen/library/admin/components/HighlightMatch';
import { cn } from '@/utils/classNames';
import { usePatchDigitalTwinCandidate } from '@/hooks/useClawDigitalTwin';
import type { DigitalTwinCandidate } from '@/services/claw/digitalTwinTypes';
import { MetaRow } from '@/routes/AIScreen/library/shared/primitives/MetaRow';
import { scoreToneClass } from './format';
import { SUBSYSTEM_ICONS, subsystemLabel } from './subsystems';

const TONE_CLASS: Record<'default' | 'success' | 'danger', string> = {
  default: 'text-muted-foreground hover:text-foreground',
  success: 'text-muted-foreground hover:bg-status-success/10 hover:text-status-success',
  danger: 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
};

const RowAction = ({
  label,
  icon,
  onClick,
  disabled,
  tone = 'default',
  trackName,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled: boolean;
  tone?: 'default' | 'success' | 'danger';
  trackName: string;
}): ReactElement => (
  <Tooltip side='top' content={label}>
    <Button
      type='button'
      variant='ghost'
      size='icon'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className={cn('size-7 focus-visible:bg-muted focus-visible:ring-0', TONE_CLASS[tone])}
    >
      {icon}
    </Button>
  </Tooltip>
);

export const CandidateRow = ({
  candidate,
  onApproved,
  onRejected,
  query = '',
}: {
  candidate: DigitalTwinCandidate;
  onApproved: (id: string) => void;
  onRejected: (id: string) => void;
  query?: string;
}): ReactElement => {
  const patch = usePatchDigitalTwinCandidate();
  const [acting, setActing] = useState<'approve' | 'reject' | 'save' | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(candidate.editedText ?? candidate.text);
  const [committed, setCommitted] = useState(candidate.editedText ?? candidate.text);

  const isBusy = acting !== null;
  const isDirty = text.trim() !== committed.trim();
  const SubsystemIcon = SUBSYSTEM_ICONS[candidate.subsystem];

  const handleApprove = async (): Promise<void> => {
    setActing('approve');
    try {
      await patch.mutateAsync({
        id: candidate.id,
        patch: { ...(isDirty ? { editedText: text.trim() } : {}), status: 'approved' },
      });
      toast.success('Approved — memory saved to Hindsight');
      onApproved(candidate.id);
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (): Promise<void> => {
    setActing('reject');
    try {
      await patch.mutateAsync({ id: candidate.id, patch: { status: 'rejected' } });
      toast.success('Rejected');
      onRejected(candidate.id);
    } finally {
      setActing(null);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!isDirty) {
      setEditing(false);
      return;
    }
    setActing('save');
    try {
      await patch.mutateAsync({ id: candidate.id, patch: { editedText: text.trim() } });
      setCommitted(text.trim());
      setEditing(false);
      toast.success('Edit saved');
    } finally {
      setActing(null);
    }
  };

  return (
    <li className='flex w-full items-center gap-3 border-b border-border px-1 py-4'>
      <Tooltip side='top' content={subsystemLabel(candidate.subsystem)}>
        <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
          {SubsystemIcon && <SubsystemIcon className='size-4' aria-hidden />}
        </span>
      </Tooltip>

      <div className='min-w-0 flex-1'>
        {editing ? (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin edit candidate text'
            disabled={isBusy}
            rows={3}
            autoFocus
            className='w-full resize-none rounded-lg border border-primary bg-background px-2.5 py-1.5 text-sm leading-relaxed text-foreground focus:outline-none disabled:opacity-60'
          />
        ) : (
          <TruncatedTooltip content={committed}>
            <p className='truncate text-sm leading-relaxed text-foreground'>
              <HighlightMatch text={committed} query={query} />
            </p>
          </TruncatedTooltip>
        )}
        <MetaRow
          className='mt-1'
          items={[
            <span
              key='confidence'
              className={cn('font-medium', scoreToneClass(candidate.signalScore))}
            >
              {Math.round(candidate.signalScore * 100)}% confidence
            </span>,
            isDirty && !editing && (
              <span key='edited' className='font-medium text-status-pending'>
                edited
              </span>
            ),
            (candidate.sourceRefs?.length ?? 0) > 0 && (
              <span key='sources'>
                {candidate.sourceRefs.length} source{candidate.sourceRefs.length !== 1 ? 's' : ''}
              </span>
            ),
          ]}
        />
      </div>

      <div className='flex shrink-0 items-center gap-2'>
        {editing ? (
          <>
            <RowAction
              label='Save edit'
              trackName='Digital Twin save candidate edit'
              disabled={isBusy}
              tone='success'
              onClick={() => void handleSave()}
              icon={
                acting === 'save' ? (
                  <Spinner className='size-4 animate-spin' />
                ) : (
                  <CheckTickCircle className='size-4' />
                )
              }
            />
            <RowAction
              label='Cancel'
              trackName='Digital Twin cancel candidate edit'
              disabled={isBusy}
              onClick={() => {
                setText(committed);
                setEditing(false);
              }}
              icon={<MultipleCrossCancelDefault className='size-4' />}
            />
          </>
        ) : (
          <>
            <RowAction
              label='Edit'
              trackName='Digital Twin edit candidate'
              disabled={isBusy}
              onClick={() => setEditing(true)}
              icon={<PencilEdit className='size-4' />}
            />
            <RowAction
              label={isDirty ? 'Save & approve' : 'Approve'}
              trackName='Digital Twin approve candidate'
              disabled={isBusy}
              tone='success'
              onClick={() => void handleApprove()}
              icon={
                acting === 'approve' ? (
                  <Spinner className='size-4 animate-spin' />
                ) : (
                  <CheckTickCircle className='size-4' />
                )
              }
            />
            <RowAction
              label='Reject'
              trackName='Digital Twin reject candidate'
              disabled={isBusy}
              tone='danger'
              onClick={() => void handleReject()}
              icon={
                acting === 'reject' ? (
                  <Spinner className='size-4 animate-spin' />
                ) : (
                  <MultipleCrossCancelCircle className='size-4' />
                )
              }
            />
          </>
        )}
      </div>
    </li>
  );
};
