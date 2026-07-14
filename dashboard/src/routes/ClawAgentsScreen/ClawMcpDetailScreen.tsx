import { ReactElement, ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  Link2,
  Plug,
  Wrench,
} from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { McpServerIcon } from '@/components/ClawAgents/McpServerIcon';
import { useClawMcp } from '@/hooks/useClawMcp';
import type { McpServer } from '@/services/claw/clawMcpTypes';

// Human-facing author per connector type, mirroring claw-auth's SERVER_AUTHOR_MAP.
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
      'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
      scope === 'global'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300'
        : scope === 'built-in'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
          : 'border-border bg-muted text-muted-foreground',
    )}
  >
    {scope}
  </span>
);

const SectionCaption = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
    {children}
  </div>
);

const MetaRow = ({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}): ReactElement => (
  <div className='flex items-center justify-between gap-3 px-4 py-3'>
    <span className='flex items-center gap-2.5 text-[13px] text-muted-foreground'>
      <span className='flex size-4 items-center justify-center'>{icon}</span>
      {label}
    </span>
    <span className='min-w-0 truncate text-right text-sm text-foreground'>{children}</span>
  </div>
);

const CopyButton = ({ value }: { value: string }): ReactElement => {
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
      aria-label='Copy URL'
      title='Copy URL'
      className='shrink-0 text-muted-foreground transition-colors hover:text-foreground'
    >
      {copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
    </button>
  );
};

const McpDetailBody = ({
  server,
  connected,
  connectedAt,
}: {
  server: McpServer;
  connected: boolean;
  connectedAt: string | undefined;
}): ReactElement => {
  const tools = server.writeToolPolicy?.tools ?? [];
  const author = SERVER_AUTHOR_MAP[server.type] ?? server.name;

  return (
    <div className='flex flex-col gap-6 pt-6'>
      {server.description && (
        <p className='text-sm leading-relaxed text-foreground'>{server.description}</p>
      )}

      {/* Connection */}
      <div>
        <SectionCaption>Connection</SectionCaption>
        <div className='divide-y divide-border overflow-hidden rounded-xl border border-border'>
          <div className='flex items-center justify-between gap-3 px-4 py-3'>
            <span className='flex items-center gap-2.5 text-[13px] text-muted-foreground'>
              <span className='flex size-4 items-center justify-center'>
                <Link2 className='size-3.5' />
              </span>
              Endpoint
            </span>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='min-w-0 truncate text-right text-sm text-muted-foreground'>
                {server.url}
              </span>
              <CopyButton value={server.url} />
            </div>
          </div>
          <MetaRow icon={<Plug className='size-3.5' />} label='Transport'>
            {server.transport || 'stdio'}
          </MetaRow>
          {connected && connectedAt && (
            <MetaRow icon={<Calendar className='size-3.5' />} label='Connected'>
              {new Date(connectedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </MetaRow>
          )}
        </div>
      </div>

      {/* Tools */}
      {tools.length > 0 && (
        <div>
          <SectionCaption>
            <span className='inline-flex items-center gap-1.5'>
              <Wrench className='size-3' />
              Tools · {tools.length}
            </span>
          </SectionCaption>
          <div className='flex flex-wrap gap-1.5'>
            {tools.map(tool => (
              <span
                key={tool}
                className='rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground'
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Advanced configuration */}
      {(server.launchConfigTemplate || server.httpConfigTemplate) && (
        <div>
          <details className='group/cfg'>
            <summary className='flex cursor-pointer select-none list-none items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden'>
              <ChevronRight className='size-3 transition-transform group-open/cfg:rotate-90' />
              <Code className='size-3' />
              Advanced configuration
            </summary>
            <pre className='mt-2 overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground'>
              {JSON.stringify(server.launchConfigTemplate ?? server.httpConfigTemplate, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Built by */}
      <div className='rounded-xl bg-muted/50 px-4 py-3 text-center'>
        <div className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          Built by {author}
        </div>
        <p className='text-xs leading-relaxed text-muted-foreground'>
          Only connect tools you trust. Connectors are created by third-party developers and may
          change over time.
        </p>
      </div>
    </div>
  );
};

const ClawMcpDetailScreen = (): ReactElement => {
  const { mcpId } = useParams<{ mcpId: string }>();
  const { data, isLoading } = useClawMcp();
  const server = data?.servers.find(s => s.id === mcpId);
  const connection = data?.connections.find(c => c.mcpServerId === mcpId);
  const connected = !!connection;

  const title = isLoading && !server ? 'Loading…' : server ? server.name : 'Integration not found';

  return (
    <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>
      <div className='flex gap-8'>
        {/* Left: back button — occupies the filter slot from the list screen. */}
        <div className='hidden w-44 shrink-0 items-start pt-4 pb-4 md:flex'>
          <Link
            to='/claw-agents/mcp'
            className='inline-flex items-center gap-1 text-sm leading-7 text-muted-foreground transition-colors hover:text-foreground'
          >
            <ChevronLeft className='size-4' />
            Back
          </Link>
        </div>

        {/* Right: hero header + read-only detail. */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <header className='flex items-center gap-3 border-b border-border pt-4 pb-4'>
            <Link
              to='/claw-agents/mcp'
              aria-label='Back to MCPs'
              className='text-muted-foreground transition-colors hover:text-foreground md:hidden'
            >
              <ChevronLeft className='size-5' />
            </Link>
            {server && <McpServerIcon server={server} size='md' />}
            <h1 className='min-w-0 flex-1 truncate text-lg font-semibold leading-7 text-foreground'>
              {title}
            </h1>
            {server && (
              <div className='flex shrink-0 items-center gap-2'>
                <Tooltip side='top' content={connected ? 'Connected' : 'Not connected'}>
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      connected ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                    )}
                  />
                </Tooltip>
                <ScopeBadge scope={deriveScope(server)} />
              </div>
            )}
          </header>

          {server && (
            <McpDetailBody
              server={server}
              connected={connected}
              connectedAt={connection?.createdAt}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ClawMcpDetailScreen;
