import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Globe, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';

/** Initials from a name, e.g. "Xyne Grafana" -> "XG". */
const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

interface ClawAgentDetailHeaderProps {
  agent: Agent;
  permissions: AgentPermissions;
  /** Current Spaces user id — used for the *true* ownership check. */
  userId: string | undefined;
  isAdmin: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  toggling: boolean;
  onToggleEnabled: (next: boolean) => void;
  cloning: boolean;
  onClone: () => void;
  publishing: boolean;
  onPublish: () => void;
  onDelete: () => void;
  moderating: 'promote' | 'demote' | null;
  onModerate: (action: 'promote' | 'demote') => void;
}

/**
 * Sticky action bar for the agent detail screen: identity on the left, and a
 * permission-gated action cluster on the right (Publish / Clone / Save /
 * enabled toggle / Delete). Save is the batched-config action — visible across
 * every config tab, enabled only when the viewer can edit and there are unsaved
 * changes.
 */
export const ClawAgentDetailHeader = ({
  agent,
  permissions,
  userId,
  isAdmin,
  dirty,
  saving,
  onSave,
  toggling,
  onToggleEnabled,
  cloning,
  onClone,
  publishing,
  onPublish,
  onDelete,
  moderating,
  onModerate,
}: ClawAgentDetailHeaderProps): ReactElement => {
  // Admins are folded into role "owner", so re-derive *true* ownership for the
  // owner-only actions (publish, delete) — see agentPermissions.ts.
  const isActualOwner = !!userId && agent.ownerUserId === userId;
  const canPublish = isActualOwner && agent.scope !== 'global';
  const canDelete = permissions.role === 'owner' && isActualOwner;
  const canModerate = isAdmin && !isActualOwner;
  const isGlobal = agent.scope === 'global';

  return (
    <header className='sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background pt-4 pb-4'>
      {/* Compact back affordance for mobile, where the left column is hidden. */}
      <Link
        to='/claw-agents'
        aria-label='Back to agents'
        className='text-muted-foreground transition-colors hover:text-foreground md:hidden'
      >
        <ChevronLeft className='size-5' />
      </Link>

      <div
        className='flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white'
        style={{ backgroundColor: agent.color || '#6366f1' }}
        aria-hidden='true'
      >
        {getInitials(agent.name)}
      </div>

      <div className='flex min-w-0 flex-col'>
        <div className='flex min-w-0 items-center gap-2'>
          <h1 className='truncate text-lg font-semibold leading-6 text-foreground'>{agent.name}</h1>
          <Badge variant={isGlobal ? 'secondary' : 'outline'} className='shrink-0'>
            {isGlobal ? 'Global' : 'Personal'}
          </Badge>
          <Badge variant={agent.enabled ? 'success' : 'outline'} className='shrink-0'>
            {agent.enabled ? 'Active' : 'Paused'}
          </Badge>
        </div>
        <span className='truncate font-mono text-xs text-muted-foreground'>@{agent.slug}</span>
      </div>

      <div className='ml-auto flex shrink-0 items-center gap-2'>
        {canModerate && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            loading={moderating !== null}
            onClick={() => onModerate(isGlobal ? 'demote' : 'promote')}
            data-track-category='Claw Agents'
            data-track-name='MODERATE_AGENT'
          >
            {!moderating &&
              (isGlobal ? <ArrowDown className='size-4' /> : <ArrowUp className='size-4' />)}
            <span className='hidden sm:inline'>
              {moderating
                ? moderating === 'promote'
                  ? 'Promoting…'
                  : 'Demoting…'
                : isGlobal
                  ? 'Demote'
                  : 'Promote'}
            </span>
          </Button>
        )}
        {canPublish && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            loading={publishing}
            onClick={onPublish}
            data-track-category='Claw Agents'
            data-track-name='PUBLISH_AGENT'
          >
            {!publishing && <Globe className='size-4' />}
            <span className='hidden sm:inline'>{publishing ? 'Publishing…' : 'Publish'}</span>
          </Button>
        )}

        <Button
          type='button'
          variant='outline'
          size='sm'
          loading={cloning}
          onClick={onClone}
          data-track-category='Claw Agents'
          data-track-name='CLONE_AGENT'
        >
          {!cloning && <Copy className='size-4' />}
          <span className='hidden sm:inline'>
            {permissions.canEdit ? 'Clone' : 'Request clone'}
          </span>
        </Button>

        {permissions.canEdit && (
          <Button
            type='button'
            size='sm'
            loading={saving}
            disabled={!dirty}
            onClick={onSave}
            data-track-category='Claw Agents'
            data-track-name='SAVE_AGENT'
            title={dirty ? 'Save changes' : 'Nothing to save'}
          >
            {!saving && <Save className='size-4' />}
            <span className='hidden sm:inline'>{saving ? 'Saving…' : 'Save'}</span>
          </Button>
        )}

        {permissions.canEdit && (
          <Tooltip side='bottom' content={agent.enabled ? 'Enabled' : 'Paused'}>
            <span className='inline-flex'>
              <Switch
                checked={agent.enabled}
                onCheckedChange={onToggleEnabled}
                disabled={toggling}
                aria-label={agent.enabled ? 'Disable agent' : 'Enable agent'}
              />
            </span>
          </Tooltip>
        )}

        {canDelete && (
          <>
            <span className='mx-0.5 h-5 w-px bg-border' aria-hidden='true' />
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              onClick={onDelete}
              data-track-category='Claw Agents'
              data-track-name='DELETE_AGENT'
              aria-label='Delete agent'
              className='text-muted-foreground hover:text-destructive'
            >
              <Trash2 className='size-4' />
            </Button>
          </>
        )}
      </div>
    </header>
  );
};
