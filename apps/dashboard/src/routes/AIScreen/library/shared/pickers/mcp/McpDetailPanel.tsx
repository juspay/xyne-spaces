import { useState, type ReactElement, type ReactNode } from 'react';
import { CopyCopied, CopyDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import {
  disableEntry,
  enableEntry,
  isEntryEnabled,
  isToolSelected,
  selectedTools,
  setToolsSelected,
  type McpCatalogEntry,
  type McpSelection,
} from './mcpCatalog';
import { McpConnectForm } from './McpConnectForm';
import { StatusBadge, VerifiedTick } from './McpIdentity';
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

function needsUserToken(server: McpServer): boolean {
  return !!server.oauth || (server.credentialForm?.fields?.length ?? 0) > 0;
}

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
}

export function McpDetailPanel({
  entry,
  catalog,
  selection,
  onSelectionChange,
  connected,
}: McpDetailPanelProps): ReactElement {
  const { server } = entry;
  const enabled = isEntryEnabled(selection, entry);
  const chosen = selectedTools(selection, entry);
  const allChosen = entry.selectable && chosen.length === entry.tools.length;
  const author = SERVER_AUTHOR_MAP[entry.slug] ?? entry.label;

  const [authOpen, setAuthOpen] = useState(false);
  const connect = useMcpConnect(server, () => setAuthOpen(false));

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-[22px] pb-9 pt-2'>
      <div className='flex w-full items-start gap-12'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <McpLogo type={entry.iconType} name={entry.label} size='lg' />
          <div className='flex min-w-0 flex-col gap-2.5 py-px'>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='truncate text-sm font-semibold leading-[1.3] tracking-[-0.28px] text-foreground'>
                {entry.label}
              </span>
              {entry.verified && <VerifiedTick />}
            </span>
            <span className='truncate text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
              Built by {author}
            </span>
          </div>
        </div>
        <button
          type='button'
          disabled={!entry.selectable}
          onClick={() =>
            onSelectionChange(
              enabled
                ? disableEntry(catalog, selection, entry)
                : enableEntry(catalog, selection, entry),
            )
          }
          title={entry.selectable ? undefined : 'No tools have synced for this integration yet'}
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: toggle MCP from detail'
          className={cn(
            'flex h-7 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-medium leading-[1.2] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            enabled
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      {entry.description && (
        <p className='w-full text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
          {entry.description}
        </p>
      )}

      <div className='flex w-full flex-col gap-4'>
        {server && (
          <Section>
            <SectionHeading label='Status' info='How this connector authenticates' />
            <MetaRows>
              <MetaRow label='Global token'>
                <StatusBadge tone={server.enabled === false ? 'neutral' : 'positive'}>
                  {server.enabled === false ? 'Inactive' : 'Active'}
                </StatusBadge>
              </MetaRow>
              <MetaRow label='User token'>
                {connected ? (
                  <StatusBadge tone='positive'>Connected</StatusBadge>
                ) : needsUserToken(server) ? (
                  <button
                    type='button'
                    onClick={() => {
                      connect.reset();
                      setAuthOpen(open => !open);
                    }}
                    data-track-category='Claw Agents'
                    data-track-name='Create agent v2: authenticate MCP'
                    className={cn(
                      'flex items-center rounded-md px-[5px] py-[3px] text-sm font-medium leading-5 text-[color:var(--mention-color)] transition-opacity',
                      authOpen ? 'opacity-50' : 'hover:underline',
                    )}
                  >
                    {authOpen ? 'Authenticating' : 'Authenticate'}
                  </button>
                ) : (
                  <MetaValue>Not required</MetaValue>
                )}
              </MetaRow>

              {authOpen && !connected && (
                <div className='flex w-full flex-col gap-2 py-1'>
                  {connect.strategy === 'oauth' ? (
                    <>
                      <p className='text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
                        {entry.label} signs in through your browser. You will come back here once it
                        is done.
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
              )}
            </MetaRows>
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
      </div>

      <div className='flex w-full flex-col text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
        <span className='font-semibold'>Built by {author}</span>
        <span>&nbsp;</span>
        <span>
          Only connect tools you trust. Connectors are created by third-party developers and may
          change over time.
        </span>
      </div>
    </div>
  );
}
