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
import { StatusBadge, VerifiedTick } from './McpIdentity';
import { McpLogo } from './McpLogo';
import { SectionHeading, Separator } from '../shared/Section';
import { ToolRow } from '../shared/ToolRow';

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
  <section className='flex flex-col gap-4'>{children}</section>
);

const MetaRows = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='flex flex-col gap-2'>{children}</div>
);

const MetaRow = ({ label, children }: { label: ReactNode; children: ReactNode }): ReactElement => (
  <div className='flex min-h-7 items-center justify-between gap-3'>
    <span className='flex items-center gap-2 text-sm leading-5 text-muted-foreground'>{label}</span>
    <span className='flex min-w-0 items-center gap-1.5 text-sm leading-5 text-foreground'>
      {children}
    </span>
  </div>
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

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] pb-2 pt-2'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <McpLogo type={entry.iconType} name={entry.label} size='lg' />
          <div className='flex min-w-0 flex-col gap-2'>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='truncate text-sm font-bold leading-5 tracking-[-0.28px] text-foreground'>
                {entry.label}
              </span>
              {entry.verified && <VerifiedTick />}
            </span>
            {entry.description && (
              <span className='truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
                {entry.description}
              </span>
            )}
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
            'flex h-7 shrink-0 items-center rounded-lg border px-2 text-sm font-medium leading-5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            enabled
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-border bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

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
                <a
                  href={`/claw-agents/mcp/${server.id}`}
                  target='_blank'
                  rel='noreferrer'
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: authenticate MCP'
                  className='font-medium text-[color:var(--mention-color)] underline-offset-2 hover:underline'
                >
                  Authenticate
                </a>
              ) : (
                <span>Not required</span>
              )}
            </MetaRow>
          </MetaRows>
        </Section>
      )}

      {server && <Separator />}

      {server && (
        <Section>
          <SectionHeading label='Connection' info='Where this connector runs' />
          <MetaRows>
            <MetaRow
              label={
                <>
                  Endpoint
                  <CopyEndpointButton value={server.url} />
                </>
              }
            >
              <span className='min-w-0 truncate'>{server.url}</span>
            </MetaRow>
            <MetaRow label='Transport'>{server.transport || 'stdio'}</MetaRow>
          </MetaRows>
        </Section>
      )}

      <Separator />

      <Section>
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
          <div className='grid grid-cols-1 gap-x-12 gap-y-4 sm:grid-cols-2'>
            {entry.tools.map(tool => {
              const checked = isToolSelected(selection, entry, tool);
              return (
                <ToolRow
                  key={tool.slug}
                  tool={tool}
                  checked={checked}
                  onToggle={() =>
                    onSelectionChange(setToolsSelected(catalog, selection, entry, [tool], !checked))
                  }
                />
              );
            })}
          </div>
        ) : (
          <p className='text-xs leading-4 text-muted-foreground'>
            No tools have synced for this integration yet. They appear here once it is connected.
          </p>
        )}
      </Section>

      <p className='text-xs leading-4 text-muted-foreground'>
        Built by {author}. Only connect tools you trust. Connectors are created by third-party
        developers and may change over time.
      </p>
    </div>
  );
}
