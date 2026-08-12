import { useState, type ReactElement } from 'react';
import { Slack } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button/index';
import Tooltip from '@/components/ui/Tooltip';
import {
  useClawOrganizationSurfaces,
  useStoreClawSlackConfigToken,
} from '@/hooks/useClawOrganization';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  DetailCard,
  DetailEmpty,
  DetailLockedNote,
} from '../library/shared/primitives/DetailPrimitives';
import { Pill } from '../library/shared/primitives/Pill';

interface OrganizationSurfacesSectionProps {
  orgId: string;
  canManage: boolean;
}

const TOKEN_INPUT_CLASS =
  'h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-50';

export function OrganizationSurfacesSection({
  orgId,
  canManage,
}: OrganizationSurfacesSectionProps): ReactElement {
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const surfaces = useClawOrganizationSurfaces(orgId, canManage);
  const storeToken = useStoreClawSlackConfigToken(orgId);

  const slackConfig = surfaces.data?.find(
    connection => connection.surface.key === 'slack' && connection.surfaceTenantId === '',
  );
  const slackWorkspace = surfaces.data?.find(
    connection => connection.surface.key === 'slack' && connection.surfaceTenantId !== '',
  );
  const rawStatus = slackConfig?.config?.['configTokenStatus'];
  const tokenStatus =
    rawStatus === 'valid' || rawStatus === 'present' || rawStatus === 'expired' ? rawStatus : null;
  const rawTeamName = slackWorkspace?.config?.['teamName'];
  const teamName =
    typeof rawTeamName === 'string' && rawTeamName.trim() ? rawTeamName.trim() : null;
  const isAccessTokenMissing = !accessToken.trim();
  const isRefreshTokenMissing = !refreshToken.trim();
  const connectDisabled = isAccessTokenMissing || isRefreshTokenMissing;
  const connectUnavailable = connectDisabled || storeToken.isPending;
  const connectDisabledReason = storeToken.isPending
    ? 'Connecting Slack…'
    : isAccessTokenMissing && isRefreshTokenMissing
      ? 'Enter both configuration tokens to connect Slack'
      : isAccessTokenMissing
        ? 'Enter the configuration access token'
        : 'Enter the configuration refresh token';

  const connectSlack = async (): Promise<void> => {
    const nextAccessToken = accessToken.trim();
    const nextRefreshToken = refreshToken.trim();
    if (!canManage || !nextAccessToken || !nextRefreshToken) return;

    try {
      await storeToken.mutateAsync({
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
      });
      setAccessToken('');
      setRefreshToken('');
      toast.success('Slack configuration token connected');
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to connect Slack'));
    }
  };

  return (
    <section className='flex w-full flex-col gap-3'>
      <DetailCard>
        {!canManage && (
          <DetailLockedNote>Only an owner or admin can configure surfaces.</DetailLockedNote>
        )}

        <div className='flex items-center gap-3 border-b border-border px-4 py-3'>
          <span className='flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground'>
            <Slack className='size-4' aria-hidden />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium leading-5 text-foreground'>Slack</p>
            <p className='truncate text-xs leading-4 text-muted-foreground'>
              {surfaces.isLoading
                ? 'Checking connection…'
                : surfaces.isError
                  ? 'Couldn’t load connection status'
                  : tokenStatus
                    ? `Configuration token: ${tokenStatus}${teamName ? ` · Installed in ${teamName}` : ''}`
                    : 'Not connected'}
            </p>
          </div>
          {!surfaces.isLoading && !surfaces.isError && (
            <Pill tone={tokenStatus === 'valid' ? 'success' : 'neutral'}>
              {tokenStatus === 'valid' ? 'Connected' : (tokenStatus ?? 'Not connected')}
            </Pill>
          )}
          {surfaces.isError && canManage && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void surfaces.refetch()}
              data-track-category='Claw Organization'
              data-track-name='Organization: retry surfaces'
            >
              Retry
            </Button>
          )}
        </div>

        {canManage ? (
          <div className='flex flex-col gap-4 p-4'>
            <div className='grid gap-3 md:grid-cols-2'>
              <label className='flex min-w-0 flex-col gap-1.5 text-xs font-medium text-foreground'>
                Configuration access token
                <input
                  type='password'
                  autoComplete='off'
                  placeholder='xoxe.xoxp-…'
                  value={accessToken}
                  onChange={event => setAccessToken(event.target.value)}
                  disabled={storeToken.isPending}
                  className={TOKEN_INPUT_CLASS}
                  data-track-category='Claw Organization'
                  data-track-name='Organization: enter Slack access token'
                />
              </label>
              <label className='flex min-w-0 flex-col gap-1.5 text-xs font-medium text-foreground'>
                Configuration refresh token
                <input
                  type='password'
                  autoComplete='off'
                  placeholder='xoxe-1-…'
                  value={refreshToken}
                  onChange={event => setRefreshToken(event.target.value)}
                  disabled={storeToken.isPending}
                  className={TOKEN_INPUT_CLASS}
                  data-track-category='Claw Organization'
                  data-track-name='Organization: enter Slack refresh token'
                />
              </label>
            </div>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <p className='text-xs leading-4 text-muted-foreground'>
                Get the pair from api.slack.com/apps → Your App Configuration Tokens. The refresh
                token rotates immediately.
              </p>
              <Tooltip
                content={connectDisabledReason}
                side='top'
                {...(connectUnavailable ? {} : { open: false })}
              >
                <span
                  className={connectUnavailable ? 'inline-flex cursor-not-allowed' : 'inline-flex'}
                >
                  <Button
                    disabled={connectDisabled}
                    loading={storeToken.isPending}
                    onClick={() => void connectSlack()}
                    data-track-category='Claw Organization'
                    data-track-name='Organization: connect Slack surface'
                  >
                    {tokenStatus ? 'Replace token' : 'Connect Slack'}
                  </Button>
                </span>
              </Tooltip>
            </div>
          </div>
        ) : (
          <DetailEmpty>Ask an organization owner or admin to connect Slack.</DetailEmpty>
        )}
      </DetailCard>
    </section>
  );
}
