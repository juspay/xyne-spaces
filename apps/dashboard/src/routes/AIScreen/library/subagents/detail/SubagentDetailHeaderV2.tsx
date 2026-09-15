import { useState, type ReactElement, type ReactNode } from 'react';
import {
  ChevronBigLeft,
  DeleteDustbin01,
  PencilEditLine,
  ThreeDotsMenuHorizontal,
} from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Popover } from '@/components/ui/Popover/index';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import type { SubagentDetailActions } from './useSubagentDetailActions';

const Action = ({
  label,
  icon,
  primary = false,
  busy = false,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  primary?: boolean;
  busy?: boolean;
  onClick: () => void;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    disabled={busy}
    data-track-category='Claw Agents'
    data-track-name={`Subagent detail v2: ${label}`}
    className={cn(
      'flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-sm font-medium leading-[1.2] transition-colors disabled:pointer-events-none disabled:opacity-50',
      primary
        ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90'
        : 'border-transparent text-foreground hover:bg-muted',
    )}
  >
    {busy ? <Loader2 className='size-3.5 animate-spin' aria-hidden /> : icon}
    {label}
  </button>
);

const MenuItem = ({
  label,
  danger = false,
  icon,
  onClick,
}: {
  label: string;
  danger?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='Claw Agents'
    data-track-name={`Subagent detail v2: ${label}`}
    className={cn(
      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm leading-5 transition-colors',
      danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted',
    )}
  >
    {icon}
    {label}
  </button>
);

export function SubagentDetailHeaderV2({
  subagent,
  actions,
  onBack,
  onEdit,
}: {
  subagent: SubagentDef;
  actions: SubagentDetailActions;
  onBack: () => void;
  onEdit: () => void;
}): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canEdit = actions.permissions?.canEdit ?? false;

  return (
    <div className='flex w-full items-center justify-between gap-4'>
      <button
        type='button'
        onClick={onBack}
        data-track-category='Claw Agents'
        data-track-name='Subagent detail v2: back'
        className='flex h-7 shrink-0 items-center rounded-[10px] pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
      >
        <span className='flex h-7 w-[22px] shrink-0 items-center justify-center'>
          <ChevronBigLeft className='size-4' aria-hidden />
        </span>
        <span className='text-base font-semibold leading-6 tracking-[-0.32px] text-foreground'>
          Subagents
        </span>
      </button>

      <div className='flex shrink-0 items-center gap-1.5'>
        {canEdit && (
          <Action
            label='Edit'
            primary
            icon={<PencilEditLine className='size-4' aria-hidden />}
            onClick={onEdit}
          />
        )}

        {canEdit && (
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align='end'
            sideOffset={4}
            trigger={
              <button
                type='button'
                aria-label='More actions'
                data-track-category='Claw Agents'
                data-track-name='Subagent detail v2: more actions'
                className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              >
                <ThreeDotsMenuHorizontal className='size-4' aria-hidden />
              </button>
            }
            className='w-52 rounded-xl border border-border bg-popover p-1 shadow-md'
          >
            <MenuItem
              label={subagent.enabled ? 'Disable subagent' : 'Enable subagent'}
              onClick={() => {
                setMenuOpen(false);
                void actions.toggleEnabled(!subagent.enabled);
              }}
            />
            <MenuItem
              label='Remove subagent'
              danger
              icon={<DeleteDustbin01 className='size-4' aria-hidden />}
              onClick={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
            />
          </Popover>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title='Remove subagent?'
        description={`${subagent.name} will stop being offered to agents. Its definition is kept, so it can be enabled again later.`}
        confirmLabel='Remove'
        danger
        onConfirm={() => void actions.remove()}
      />
    </div>
  );
}
