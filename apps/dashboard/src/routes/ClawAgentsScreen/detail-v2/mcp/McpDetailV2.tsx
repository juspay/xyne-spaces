import { ReactElement, ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, ChevronLeft, Copy } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { McpServerIcon } from '@/components/ClawAgents/McpServerIcon';
import { useClawMcp } from '@/hooks/useClawMcp';
import type { McpServer } from '@/services/claw/clawMcpTypes';

const SERVER_AUTHOR_MAP: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  google: 'Google',
  gmail: 'Google',
  'google-drive': 'Google',
  microsoft: 'Microsoft',
  slack: 'Slack',
  figma: 'Figma',
  notion: 'Notion',
  salesforce: 'Salesforce',
  stripe: 'Stripe',
  bitbucket: 'Atlassian',
  'xyne-spaces': 'Xyne',
};

const deriveScope = (server: McpServer): string => {
  const rawScope = server.connectorMeta?.['scope'] as string | undefined;
  const rawPublishStatus = server.connectorMeta?.['publishStatus'] as string | undefined;
  const isPlatformConnector = !rawScope && !rawPublishStatus;
  return rawScope ?? (isPlatformConnector ? 'built-in' : 'unknown');
};

const ScopeBadge = ({ scope }: { scope: string }): ReactElement => (
  <span
    className={cn(
      'shrink-0 rounded-full border px-2 py-0.5 text-body-sm font-medium capitalize',
      scope === 'global'
        ? 'border-border bg-muted text-status-scheduled'
        : scope === 'built-in'
          ? 'border-stage-completed-border bg-stage-completed text-status-success'
          : 'border-border bg-muted text-muted-foreground',
    )}
  >
    {scope}
  </span>
);

const CopyButton = ({
  value,
  label = 'Copy URL',
}: {
  value: string;
  label?: string;
}): ReactElement => {
  const [copied, setCopied] = useState(false);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  };
  return (
    <button
      type='button'
      onClick={() => void onCopy()}
      data-track-category='Claw Agents'
      data-track-name='Copy MCP URL'
      aria-label={label}
      title={label}
      className='shrink-0 text-muted-foreground transition-colors hover:text-foreground'
    >
      {copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
    </button>
  );
};

const Field = ({
  label,
  children,
  action,
  subtleValue = false,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
  subtleValue?: boolean;
}): ReactElement => (
  <div className='flex min-w-0 flex-col gap-1.5'>
    <span className='text-body-md font-medium text-foreground'>{label}</span>
    <div className='flex items-center gap-2 rounded-xl border border-border px-3 py-2.5'>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-body-md',
          subtleValue ? 'text-foreground/60' : 'text-foreground/80',
        )}
      >
        {children}
      </span>
      {action}
    </div>
  </div>
);

const McpDetailBody = ({ server }: { server: McpServer }): ReactElement => {
  const author = SERVER_AUTHOR_MAP[server.type] ?? server.name;
  const rawConfig = server.launchConfigTemplate ?? server.httpConfigTemplate;
  const config = rawConfig ? JSON.stringify(rawConfig, null, 2) : null;
  const launch = server.launchConfigTemplate;
  const command = launch?.cmd ? [launch.cmd, ...(launch.args ?? [])].join(' ') : null;

  return (
    <div className='flex flex-col gap-6 pt-8'>
      <div className='grid gap-4 sm:grid-cols-2'>
        {server.url ? (
          <Field label='End Point' action={<CopyButton value={server.url} />}>
            {server.url}
          </Field>
        ) : command ? (
          <Field label='End Point' action={<CopyButton value={command} label='Copy command' />}>
            {command}
          </Field>
        ) : null}
        <Field label='Transport' subtleValue>
          {server.transport || 'stdio'}
        </Field>
      </div>

      {config && (
        <div className='flex min-w-0 flex-col gap-1.5'>
          <span className='text-body-md font-medium text-foreground'>Advanced Configuration</span>
          <div className='flex items-start gap-2 rounded-xl border border-border px-3 py-2.5'>
            <pre className='min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all font-sans text-body-md text-foreground/80'>
              {config}
            </pre>
            <CopyButton value={config} label='Copy configuration' />
          </div>
        </div>
      )}

      <div className='rounded-xl bg-muted/50 px-4 py-3 text-center'>
        <div className='mb-1 text-body-sm font-semibold uppercase tracking-wide text-muted-foreground'>
          Built by {author}
        </div>
        <p className='text-body-sm text-foreground/60'>
          Only connect tools you trust. Connectors are created by third-party developers and may
          change over time.
        </p>
      </div>
    </div>
  );
};

const McpDetailV2 = (): ReactElement => {
  const { mcpId, workspaceId } = useParams<{ mcpId: string; workspaceId?: string }>();
  const { data, isLoading } = useClawMcp();
  const server = data?.servers.find(s => s.id === mcpId);
  const connected = !!data?.connections.find(c => c.mcpServerId === mcpId);
  const backTo = `${workspaceId ? `/${workspaceId}` : ''}/ai/library?tab=mcp`;

  const title = isLoading && !server ? 'Loading…' : server ? server.name : 'Integration not found';

  return (
    <div className='mx-auto w-full max-w-[800px] px-6 pt-4 pb-16'>
      <Link
        to={backTo}
        aria-label='Back to MCPs'
        className='inline-flex items-center gap-1.5 text-body-md text-foreground transition-opacity hover:opacity-70'
      >
        <ChevronLeft className='size-4' />
        MCP
      </Link>

      <header className='mt-8 flex flex-col gap-3'>
        {server && <McpServerIcon server={server} size='md' />}
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <h1 className='min-w-0 truncate text-heading-sm font-semibold text-foreground'>
            {title}
          </h1>
          {server && (
            <>
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-body-sm',
                  connected
                    ? 'bg-stage-completed text-status-success'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {connected ? 'Active' : 'Inactive'}
              </span>
              <ScopeBadge scope={deriveScope(server)} />
            </>
          )}
        </div>
        {server?.description && (
          <p className='text-body-md text-foreground/60'>{server.description}</p>
        )}
      </header>

      {server && <McpDetailBody server={server} />}
    </div>
  );
};

export default McpDetailV2;
