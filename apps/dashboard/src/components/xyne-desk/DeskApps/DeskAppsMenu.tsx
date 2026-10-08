import { ReactElement, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Grid01, PlusDefault as Plus, CheckTickSingle as Check } from '@xyne/icons';
import { MAX_DESK_APPS } from '@xyne/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Button } from '../../ui/Button/Button';
import Tooltip from '../../ui/Tooltip';
import { AppIcon } from '../../AppIcon/AppIcon';
import { AppPickerDialog } from '../../BarCustomize/AppPickerDialog';
import type { ArtifactAppSummary } from '../../../services/claw/artifactAppsService';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import type { DeskApps } from './useDeskApps';

const TRACK = 'Support';

/** Desks show their apps to every member, so only workspace-published apps qualify. */
const isWorkspaceApp = (app: ArtifactAppSummary): boolean => app.visibility === 'WORKSPACE';

interface DeskAppsMenuProps {
  channelId: string;
  deskApps: DeskApps;
  /** The desk owner or a channel admin — the same rule the preference's ACL enforces. */
  canManage: boolean;
  /** The app currently shown in place of the ticket list, if any. */
  activeAppId: string | null;
  onOpenApp: (appId: string) => void;
}

/**
 * The Desk header's Apps button. Everyone sees the apps added to this desk and
 * can open them; the desk owner and channel admins also get "Add or remove
 * apps…". Hidden entirely when there is nothing to show and nothing to manage.
 *
 * The list is the desk's channel_published_apps rows — shared by everyone on the
 * desk, unlike the per-device bars elsewhere — written through the same upsert
 * mutator the desk settings use, so the server ACL (owner or channel admin) is
 * what actually decides whether a change sticks.
 */
export const DeskAppsMenu = ({
  channelId,
  deskApps,
  canManage,
  activeAppId,
  onOpenApp,
}: DeskAppsMenuProps): ReactElement | null => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const zero = useZero();
  const { ids, apps, unavailableIds } = deskApps;

  if (!canManage && apps.length === 0) return null;

  // One app per call, against the row set as it stands on the server, so two
  // admins changing the desk at once don't overwrite each other.
  const publish = (appId: string): void => {
    void surfaceMutationError(
      zero.mutate(
        mutators.channel.publishApp({ id: uuidv4(), channelId, appId, timestamp: Date.now() }),
      ),
      'Could not add the app to this desk',
    );
  };
  const unpublish = (appId: string): void => {
    void surfaceMutationError(
      zero.mutate(mutators.channel.unpublishApp({ channelId, appId })),
      'Could not remove the app from this desk',
    );
  };

  const onToggle = (app: ArtifactAppSummary, next: boolean): void => {
    if (next) publish(app.id);
    else unpublish(app.id);
  };

  const removeUnavailable = (): void => {
    unavailableIds.forEach(unpublish);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <span>
            <Tooltip content='Desk apps' side='bottom'>
              <Button
                variant='outline'
                size='sm'
                className='rounded-[10px] border-border hover:bg-muted text-muted-foreground'
                aria-label='Desk apps'
                data-track-category={TRACK}
                data-track-name='OpenDeskAppsMenu'
                data-track-metadata={JSON.stringify({ channelId, appCount: apps.length })}
              >
                <Grid01 size={16} />
                {apps.length > 0 ? <span>{apps.length}</span> : <span>Apps</span>}
              </Button>
            </Tooltip>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <p className='px-2 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            Desk apps
          </p>
          {apps.length === 0 ? (
            <p className='px-2 pb-2 text-xs text-muted-foreground'>
              No apps on this desk yet. Apps you add here are visible to everyone on the desk.
            </p>
          ) : (
            apps.map(app => (
              <DropdownMenuItem
                key={app.id}
                onClick={() => onOpenApp(app.id)}
                data-track-category={TRACK}
                data-track-name='OpenDeskApp'
                data-track-metadata={JSON.stringify({ channelId, appId: app.id })}
              >
                <span className='mr-2 flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-border bg-muted text-muted-foreground'>
                  <AppIcon name={app.icon} size={14} aria-hidden='true' />
                </span>
                <span className='min-w-0 flex-1 truncate'>{app.title}</span>
                {activeAppId === app.id && <Check size={14} className='ml-2 shrink-0' />}
              </DropdownMenuItem>
            ))
          )}
          {canManage && (
            <>
              {unavailableIds.length > 0 && (
                <DropdownMenuItem
                  onClick={removeUnavailable}
                  className='text-xs text-muted-foreground'
                  data-track-category={TRACK}
                  data-track-name='RemoveUnavailableDeskApps'
                >
                  {unavailableIds.length === 1
                    ? '1 app is no longer available — remove it'
                    : `${unavailableIds.length} apps are no longer available — remove them`}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setPickerOpen(true)}
                data-track-category={TRACK}
                data-track-name='OpenDeskAppPicker'
              >
                <Plus size={14} className='mr-2 shrink-0' />
                Add or remove apps…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canManage && (
        <AppPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          addedAppIds={new Set(ids)}
          isFull={ids.length >= MAX_DESK_APPS}
          onToggle={onToggle}
          appFilter={isWorkspaceApp}
          description='Apps added here appear on this desk for everyone. Only apps published to the workspace can be added.'
          limitNote={{
            normal: `Up to ${MAX_DESK_APPS} apps per desk.`,
            full: 'This desk already has the maximum number of apps. Switch one off to add another.',
          }}
          trackCategory={TRACK}
        />
      )}
    </>
  );
};
