import { useState, type ReactElement, type ReactNode } from 'react';
import {
  ChevronBigLeft,
  CopyDefault,
  DeleteDustbin01,
  PencilEditLine,
  ThreeDotsMenuHorizontal,
} from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Popover } from '@/components/ui/Popover/index';
import { CloneAgentDialog } from '@/components/ClawAgents/CloneAgentDialog';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { RenameHandleDialog } from '@/components/ClawAgents/RenameHandleDialog';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentDetailActions } from './useAgentDetailActions';

const Action = ({
  label,
  icon,
  primary = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled || busy}
    data-track-category='Claw Agents'
    data-track-name={`Agent detail v2: ${label}`}
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
    data-track-name={`Agent detail v2: ${label}`}
    className={cn(
      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
      danger ? 'text-destructive' : 'text-foreground',
    )}
  >
    {icon}
    {label}
  </button>
);

interface AgentDetailHeaderV2Props {
  agent: Agent;
  actions: AgentDetailActions;
  onBack: () => void;
  onEdit: () => void;
}

export function AgentDetailHeaderV2({
  agent,
  actions,
  onBack,
  onEdit,
}: AgentDetailHeaderV2Props): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moderateOpen, setModerateOpen] = useState<'promote' | 'demote' | null>(null);

  const { permissions, isAdmin, isOwner, busy } = actions;
  const canEdit = permissions?.canEdit ?? false;
  const isGlobal = agent.scope === 'global';

  const showModerate = isAdmin;
  const showPublish = !isAdmin && isOwner && !isGlobal;

  const hasMenu = canEdit || isOwner;

  return (
    <div className='flex w-full items-center justify-between gap-4'>
      <button
        type='button'
        onClick={onBack}
        data-track-category='Claw Agents'
        data-track-name='Agent detail v2: back'
        className='flex h-7 shrink-0 items-center rounded-[10px] pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
      >
        <span className='flex h-7 w-[22px] shrink-0 items-center justify-center'>
          <ChevronBigLeft className='size-4' aria-hidden />
        </span>
        <span className='text-base font-semibold leading-6 tracking-[-0.32px] text-foreground'>
          Agents
        </span>
      </button>

      <div className='flex shrink-0 items-center gap-1.5'>
        {showModerate && (
          <Action
            label={isGlobal ? 'Unpublish' : 'Publish'}
            busy={busy.moderating !== null}
            onClick={() => setModerateOpen(isGlobal ? 'demote' : 'promote')}
          />
        )}
        {showPublish && (
          <Action label='Publish' busy={busy.publishing} onClick={() => void actions.publish()} />
        )}

        <Action
          label='Clone'
          icon={<CopyDefault className='size-4' aria-hidden />}
          busy={busy.cloning}
          onClick={() => setCloneOpen(true)}
        />

        {canEdit && (
          <Action
            label='Edit'
            primary
            icon={<PencilEditLine className='size-4' aria-hidden />}
            onClick={onEdit}
          />
        )}

        {hasMenu && (
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
                data-track-name='Agent detail v2: more actions'
                className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              >
                <ThreeDotsMenuHorizontal className='size-4' aria-hidden />
              </button>
            }
            className='w-52 rounded-xl border border-border bg-popover p-1 shadow-md'
          >
            {canEdit && (
              <MenuItem
                label={agent.enabled ? 'Pause agent' : 'Enable agent'}
                onClick={() => {
                  setMenuOpen(false);
                  void actions.toggleEnabled(!agent.enabled);
                }}
              />
            )}
            {isOwner && (
              <MenuItem
                label='Rename handle'
                onClick={() => {
                  setMenuOpen(false);
                  setRenameOpen(true);
                }}
              />
            )}
            {isOwner && (
              <MenuItem
                label='Delete agent'
                danger
                icon={<DeleteDustbin01 className='size-4 shrink-0' aria-hidden />}
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteOpen(true);
                }}
              />
            )}
          </Popover>
        )}
      </div>

      <CloneAgentDialog
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        sourceName={agent.name}
        needsApproval={!canEdit}
        submitting={busy.cloning}
        onConfirm={name => {
          void actions.clone(name).then(() => setCloneOpen(false));
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${agent.name}?`}
        description='This removes the agent and its configuration. It cannot be undone.'
        confirmLabel='Delete'
        danger
        loading={busy.deleting}
        onConfirm={() => void actions.remove()}
      />

      <ConfirmDialog
        open={moderateOpen !== null}
        onOpenChange={open => setModerateOpen(open ? moderateOpen : null)}
        title={moderateOpen === 'demote' ? `Unpublish ${agent.name}?` : `Publish ${agent.name}?`}
        description={
          moderateOpen === 'demote'
            ? 'It becomes personal again and leaves the shared library.'
            : 'It becomes global and everyone in the workspace can use it.'
        }
        confirmLabel={moderateOpen === 'demote' ? 'Unpublish' : 'Publish'}
        loading={busy.moderating !== null}
        onConfirm={() => {
          const action = moderateOpen;
          if (!action) return;
          void actions.moderate(action).then(() => setModerateOpen(null));
        }}
      />

      <RenameHandleDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentHandle={agent.slug}
        onRename={actions.rename}
      />
    </div>
  );
}
