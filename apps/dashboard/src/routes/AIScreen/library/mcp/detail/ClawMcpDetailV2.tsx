import { type ReactElement, type ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronBigLeft, Tools } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button/Button';
import { useAuth } from '@/hooks/useAuth';
import {
  autoConnectSpaces,
  canEditMcpDefinition,
  createMcpConnection,
  deleteMcpConnection,
  mcpCredentialFields,
  mcpRequiresCredentials,
  startMcpOAuth,
} from '@/services/claw/clawMcpService';
import { useIsClawAdmin } from '@/hooks/useIsClawAdmin';
import { openOAuthConsent } from '../../shared/pickers/mcp/openOAuthConsent';
import { McpConnectDialog } from './McpConnectDialog';
import { McpDefinitionDialog } from './McpDefinitionDialog';
import { Pill } from '../../shared/primitives/Pill';
import { CopyButton } from '../../shared/primitives/CopyButton';
import { McpLogo } from '../../shared/pickers/mcp/McpLogo';
import { useMcpCatalog } from '../../shared/pickers/mcp/useMcpCatalog';
import { VerifiedTick } from '../../shared/pickers/mcp/McpIdentity';

const NOTE =
  'Only connect tools you trust. Connectors are created by third-party developers and may change over time.';

function Field({
  label,
  children,
  action,
  single = false,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
  /** Single-line field — fixed 54px box, so neighbours line up exactly. */
  single?: boolean;
}): ReactElement {
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-3'>
      <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
        {label}
      </span>
      <div
        className={cn(
          'flex w-full gap-2 rounded-2xl border border-border bg-card',
          single ? 'h-10 items-center px-3' : 'items-start p-4',
        )}
      >
        <div className='min-w-0 flex-1'>{children}</div>
        {action}
      </div>
    </div>
  );
}

const ClawMcpDetailV2 = (): ReactElement => {
  const navigate = useNavigate();
  const { type, workspaceId } = useParams<{ type?: string; workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';

  const { entries, connectedServerIds, connectionsByServerId, loading, isError, refetch } =
    useMcpCatalog();
  const { user } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { data: isClawAdmin = false } = useIsClawAdmin();
  const entry = entries.find(candidate => candidate.slug === type);
  const server = entry?.server;

  // `httpConfigTemplate` is what a client needs to reach this connector — the
  // url plus whatever headers it expects.
  const config = server?.httpConfigTemplate ?? server?.launchConfigTemplate ?? null;
  const configJson = config ? JSON.stringify(config, null, 2) : null;
  const connected = server ? connectedServerIds.has(server.id) : false;
  const needsCredentials = server ? mcpRequiresCredentials(server) : false;
  const connection = server ? connectionsByServerId.get(server.id) : undefined;
  // Only connectors with fields have anything to re-enter; an OAuth connector
  // is re-authorised by connecting again, not by editing a form.
  const canEditCredentials = server ? mcpCredentialFields(server).length > 0 : false;
  const canEditDefinition = server ? canEditMcpDefinition(server, user?.id, isClawAdmin) : false;

  const handleDisconnect = async (): Promise<void> => {
    if (!connection || !user?.id) return;
    setConnectError(null);
    setConnecting(true);
    try {
      await deleteMcpConnection(user.id, connection.id);
      refetch();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Could not disconnect. Try again.');
    } finally {
      setConnecting(false);
    }
  };

  /**
   * Same branch order claw's own MCP page uses: OAuth connectors redirect to
   * consent, Spaces self-connects from the session, and anything else with no
   * credential form is created outright. Credential-form connectors are not
   * handled here — see the note rendered beside the button.
   */
  const handleConnect = async (): Promise<void> => {
    if (!server || !user?.id) return;
    setConnectError(null);

    // Credential connectors collect their fields first; everything else can
    // connect straight away.
    if (needsCredentials) {
      setCredentialsOpen(true);
      return;
    }

    setConnecting(true);
    try {
      if (server.type === 'xyne-spaces') {
        await autoConnectSpaces(user.id);
        refetch();
      } else if (server.oauth || server.type === 'google' || server.type === 'microsoft') {
        openOAuthConsent(await startMcpOAuth(user.id, server.type));
        return;
      } else {
        await createMcpConnection(user.id, server.id);
        refetch();
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Could not connect. Try again.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawMcpDetailV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 pb-6'>
        <div className='bg-background sticky top-0 z-10 flex flex-col gap-6 pb-3 pt-6'>
          <button
            type='button'
            onClick={() => void navigate(`${libraryPath}?tab=mcp`)}
            data-track-category='Claw Agents'
            data-track-name='MCP detail v2: back'
            className='flex h-7 w-fit shrink-0 items-center rounded-[10px] pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <span className='flex h-7 w-[22px] shrink-0 items-center justify-center'>
              <ChevronBigLeft className='size-4' aria-hidden />
            </span>
            <span className='text-base font-semibold leading-6 tracking-[-0.32px] text-foreground'>
              MCP
            </span>
          </button>
        </div>

        {loading ? (
          <div className='flex w-full flex-col gap-4'>
            <Skeleton className='size-10 rounded-xl' />
            <Skeleton className='h-6 w-52' />
            <Skeleton className='h-4 w-80' />
            <Skeleton className='h-32 w-full rounded-2xl' />
          </div>
        ) : isError || !entry ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            Couldn&apos;t load this connector.
          </p>
        ) : (
          <>
            <div className='flex w-full items-start gap-3'>
              <McpLogo type={entry.iconType} name={entry.label} size='md' />

              <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate text-sm font-semibold leading-[22px] text-foreground'>
                    {entry.label}
                  </span>
                  {entry.verified && <VerifiedTick />}
                  <Pill tone={connected ? 'success' : 'neutral'}>
                    {connected ? 'Connected' : 'Not connected'}
                  </Pill>
                  {server?.enabled === false && <Pill tone='neutral'>Inactive</Pill>}
                </div>

                <p className='text-xs leading-[22px] text-foreground/80 opacity-70'>
                  {entry.description || 'No description added'}
                </p>
              </div>

              {server && (
                <div className='flex shrink-0 flex-col items-end gap-1'>
                  <div className='flex items-center gap-2'>
                    {canEditDefinition && (
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={(): void => setDefinitionOpen(true)}
                        data-track-category='Claw MCP'
                        data-track-name='EditMcpDefinition'
                      >
                        Edit definition
                      </Button>
                    )}
                    {connected && canEditCredentials && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={(): void => setCredentialsOpen(true)}
                        disabled={connecting}
                        data-track-category='Claw MCP'
                        data-track-name='EditMcpCredentials'
                      >
                        Edit credentials
                      </Button>
                    )}
                    {connected ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={(): void => void handleDisconnect()}
                        disabled={connecting || !connection}
                        data-track-category='Claw MCP'
                        data-track-name='DisconnectMcp'
                      >
                        {connecting ? 'Disconnecting…' : 'Disconnect'}
                      </Button>
                    ) : (
                      <Button
                        size='sm'
                        onClick={(): void => void handleConnect()}
                        disabled={connecting || server.enabled === false}
                        data-track-category='Claw MCP'
                        data-track-name='ConnectMcp'
                      >
                        {connecting ? 'Connecting…' : 'Connect'}
                      </Button>
                    )}
                  </div>
                  {connectError && (
                    <span className='max-w-[260px] text-right text-[11px] leading-4 text-destructive'>
                      {connectError}
                    </span>
                  )}
                  {notice && (
                    <span className='max-w-[260px] text-right text-[11px] leading-4 text-muted-foreground'>
                      {notice}
                    </span>
                  )}
                </div>
              )}
            </div>

            {server && (
              <div className='flex w-full items-start gap-3'>
                <Field
                  single
                  label='End Point'
                  {...(server.url
                    ? {
                        action: (
                          <CopyButton
                            value={server.url}
                            label='Copy endpoint'
                            trackName='MCP detail v2: copy endpoint'
                          />
                        ),
                      }
                    : {})}
                >
                  {server.url ? (
                    <p className='truncate text-sm font-normal leading-5 text-foreground/80'>
                      {server.url}
                    </p>
                  ) : (
                    // stdio connectors are launched as a process, so there's no URL.
                    <p className='truncate text-sm font-normal leading-5 text-muted-foreground'>
                      Launched locally — no endpoint
                    </p>
                  )}
                </Field>

                <Field single label='Transport'>
                  <p className='truncate text-sm font-normal leading-5 text-muted-foreground'>
                    {server.transport || 'stdio'}
                  </p>
                </Field>
              </div>
            )}

            {configJson && (
              <Field
                label='Configuration'
                action={
                  <CopyButton
                    value={configJson}
                    label='Copy configuration'
                    trackName='MCP detail v2: copy configuration'
                  />
                }
              >
                <pre className='w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/80'>
                  {configJson}
                </pre>
              </Field>
            )}

            {entry.tools.length > 0 && (
              <div className='flex w-full flex-col gap-2'>
                <div className='flex items-center gap-1.5'>
                  <Tools className='size-[11px] shrink-0 text-muted-foreground' aria-hidden />
                  <span className='text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground'>
                    Tools · {entry.tools.length}
                  </span>
                </div>
                <div className='flex flex-wrap gap-1.5'>
                  {entry.tools.map(tool => (
                    <span
                      key={tool.slug}
                      title={tool.description || tool.name}
                      className='rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[12px] leading-4 text-muted-foreground'
                    >
                      {tool.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className='w-full text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
              Note: {NOTE}
            </p>
          </>
        )}
      </div>

      {server && user?.id && (
        <McpConnectDialog
          server={server}
          iconType={entry?.iconType ?? server.type}
          label={entry?.label ?? server.name}
          {...(entry?.description ? { description: entry.description } : {})}
          userId={user.id}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
          onConnected={refetch}
        />
      )}

      {server && user?.id && canEditDefinition && (
        <McpDefinitionDialog
          server={server}
          label={entry?.label ?? server.name}
          userId={user.id}
          open={definitionOpen}
          onOpenChange={setDefinitionOpen}
          onSaved={(queuedForReview): void => {
            setNotice(queuedForReview ? 'Sent to admins for review.' : 'Definition updated.');
            refetch();
          }}
        />
      )}
    </div>
  );
};

export default ClawMcpDetailV2;
