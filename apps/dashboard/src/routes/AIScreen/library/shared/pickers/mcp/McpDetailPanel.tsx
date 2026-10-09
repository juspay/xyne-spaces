import { useState, type ReactElement, type ReactNode } from 'react';
import { CopyCopied, CopyDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import {
  scopeHint,
  scopeLabel,
  isToolSelected,
  selectedTools,
  setToolsSelected,
  type McpCatalogEntry,
  type McpSelection,
} from './mcpCatalog';
import { McpConnectForm } from './McpConnectForm';
import Tooltip from '@/components/ui/Tooltip';
import { Pill } from '../../primitives/Pill';
import { McpLogo } from './McpLogo';
import { useMcpConnect } from './useMcpConnect';
import { SectionHeading, Separator } from '../../primitives/Section';
import { ToolRow } from '../../primitives/ToolRow';

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

const Section = ({ children }: { children: ReactNode }): ReactElement => (
  <section className='flex w-full flex-col gap-3'>{children}</section>
);

const MetaRows = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='flex w-full flex-col gap-2'>{children}</div>
);

const MetaRow = ({
  label,
  muted = false,
  children,
}: {
  label: ReactNode;
  muted?: boolean;
  children: ReactNode;
}): ReactElement => (
  <div className='flex h-7 w-full items-center justify-between gap-3'>
    <span
      className={cn(
        'flex items-center gap-2 text-sm font-medium leading-5',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {label}
    </span>
    <span className='flex min-w-0 items-center gap-1.5'>{children}</span>
  </div>
);

const MetaValue = ({ children }: { children: ReactNode }): ReactElement => (
  <span className='min-w-0 truncate text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
    {children}
  </span>
);

const CopyEndpointButton = ({ value }: { value: string }): ReactElement => {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type='button'
      onClick={() => void copy()}
      aria-label='Copy endpoint'
      title='Copy endpoint'
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: copy MCP endpoint'
      className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
    >
      {copied ? (
        <CopyCopied className='size-4' aria-hidden />
      ) : (
        <CopyDefault className='size-4' aria-hidden />
      )}
    </button>
  );
};

interface McpDetailPanelProps {
  entry: McpCatalogEntry;
  catalog: readonly McpCatalogEntry[];
  selection: McpSelection;
  onSelectionChange: (next: McpSelection) => void;
  connected: boolean;
  orgCovered?: boolean;
}

export function McpDetailPanel({
  entry,
  catalog,
  selection,
  onSelectionChange,
  connected,
  orgCovered = false,
}: McpDetailPanelProps): ReactElement {
  const { server } = entry;
  const chosen = selectedTools(selection, entry);
  const allChosen = entry.selectable && chosen.length === entry.tools.length;
  const author = SERVER_AUTHOR_MAP[entry.slug] ?? entry.label;

  const [authOpen, setAuthOpen] = useState(false);
  const connect = useMcpConnect(server, () => setAuthOpen(false));
  const needsConnection = connect.strategy === 'oauth' || connect.fields.length > 0;
  const connectionHint = connected
    ? 'Runs with the key you connected.'
    : orgCovered
      ? 'Runs with a key your organisation shares. Connect your own to use it instead.'
      : 'Needs a key before this connector can do anything.';

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 flex-col gap-4 px-[22px] pb-4 pt-2'>
        <div className='flex w-full items-start gap-12'>
          <div className='flex min-w-0 flex-1 items-center gap-2.5'>
            <McpLogo type={entry.iconType} name={entry.label} size='lg' />
            <div className='flex min-w-0 flex-col gap-2.5 py-px'>
              <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
                <span className='truncate text-sm font-semibold leading-[1.3] tracking-[-0.28px] text-foreground'>
                  {entry.label}
                </span>
                <Tooltip content={scopeHint(entry.scope)} side='top'>
                  <span className='flex'>
                    <Pill tone={entry.scope === 'global' ? 'success' : 'neutral'}>
                      {scopeLabel(entry.scope)}
                    </Pill>
                  </span>
                </Tooltip>
                {needsConnection && (
                  <Tooltip content={connectionHint} side='top'>
                    <span className='flex'>
                      <Pill tone={connected || orgCovered ? 'success' : 'warning'}>
                        {connected
                          ? 'Connected'
                          : orgCovered
                            ? 'Available via org'
                            : 'Not connected'}
                      </Pill>
                    </span>
                  </Tooltip>
                )}
              </span>
              <span className='truncate text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
                Built by {author}
              </span>
            </div>
          </div>
          {needsConnection && !connected && (
            <button
              type='button'
              onClick={() => {
                connect.reset();
                setAuthOpen(open => !open);
              }}
              title={
                orgCovered
                  ? 'Your own key takes precedence over the shared one'
                  : `Connect ${entry.label}`
              }
              data-track-category='Claw Agents'
              data-track-name='Create agent v2: connect MCP from detail'
              className={cn(
                'flex h-7 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-medium leading-[1.2] transition-colors',
                orgCovered
                  ? 'border border-border bg-card text-foreground hover:bg-muted'
                  : 'border border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
                authOpen && 'opacity-50',
              )}
            >
              {authOpen ? 'Connecting' : orgCovered ? 'Use your own key' : 'Connect'}
            </button>
          )}
        </div>

        {entry.description && (
          <p className='w-full text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
            {entry.description}
          </p>
        )}
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] pb-9'>
        {server && authOpen && !connected && (
          <Section>
            <div className='flex w-full flex-col gap-2 py-1'>
              {connect.strategy === 'oauth' ? (
                <>
                  <p className='text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
                    {entry.label} signs in through your browser. You will come back here once it is
                    done.
                  </p>
                  {connect.error && (
                    <p className='text-xs leading-4 text-destructive'>{connect.error}</p>
                  )}
                  <div className='flex items-center justify-end gap-1.5'>
                    <button
                      type='button'
                      onClick={() => setAuthOpen(false)}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent v2: cancel MCP oauth'
                      className='flex h-7 items-center justify-center rounded-lg bg-card px-2 py-1.5 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-muted'
                    >
                      Cancel
                    </button>
                    <button
                      type='button'
                      disabled={connect.isPending}
                      onClick={() => connect.connect({})}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent v2: start MCP oauth'
                      className='flex h-7 items-center justify-center rounded-lg bg-foreground/[0.06] px-2 py-1.5 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      {connect.isPending ? 'Redirecting…' : 'Continue'}
                    </button>
                  </div>
                </>
              ) : (
                <McpConnectForm
                  fields={connect.fields}
                  isPending={connect.isPending}
                  error={connect.error}
                  onCancel={() => setAuthOpen(false)}
                  onSubmit={connect.connect}
                />
              )}
            </div>
          </Section>
        )}

        {server && <Separator />}

        {server && (
          <Section>
            <SectionHeading label='Connection' info='Where this connector runs' />
            <MetaRows>
              <MetaRow
                muted
                label={
                  <>
                    Endpoint
                    <CopyEndpointButton value={server.url} />
                  </>
                }
              >
                <MetaValue>{server.url}</MetaValue>
              </MetaRow>
              <MetaRow muted label='Transport'>
                <MetaValue>{server.transport || 'stdio'}</MetaValue>
              </MetaRow>
            </MetaRows>
          </Section>
        )}

        <Separator />

        <section className='flex w-full flex-col gap-4'>
          <SectionHeading
            label='Tools'
            info='Only the tools you select here can be called by this agent'
            {...(entry.selectable && {
              action: (
                <button
                  type='button'
                  onClick={() =>
                    onSelectionChange(
                      setToolsSelected(catalog, selection, entry, entry.tools, !allChosen),
                    )
                  }
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: toggle all MCP tools'
                  className='shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
                >
                  {allChosen ? 'Clear all' : `Select all (${chosen.length}/${entry.tools.length})`}
                </button>
              ),
            })}
          />

          {entry.selectable ? (
            <div className='grid w-full grid-cols-1 gap-x-12 gap-y-4 sm:grid-cols-2'>
              {entry.tools.map(tool => {
                const checked = isToolSelected(selection, entry, tool);
                return (
                  <ToolRow
                    key={tool.slug}
                    tool={tool}
                    checked={checked}
                    onToggle={() =>
                      onSelectionChange(
                        setToolsSelected(catalog, selection, entry, [tool], !checked),
                      )
                    }
                  />
                );
              })}
            </div>
          ) : (
            <p className='text-sm font-normal leading-5 text-muted-foreground'>
              No tools have synced for this integration yet. They appear here once it is connected.
            </p>
          )}
        </section>

        <p className='w-full text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
          Only connect tools you trust. Connectors are created by third-party developers and may
          change over time.
        </p>
      </div>
    </div>
  );
}
