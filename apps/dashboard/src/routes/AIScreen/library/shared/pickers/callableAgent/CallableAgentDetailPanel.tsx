import { useState, type ReactElement, type ReactNode } from 'react';
import { Staroflife, Tools, UserBot } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Textarea } from '@/components/ui/Textarea';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { ScrollFadeBox } from '../../primitives/ProseBox';
import { SectionHeading, Separator } from '../../primitives/Section';
import { Pill } from '../../primitives/Pill';
import { ChipIconTile, TokenChip } from '../../primitives/TokenChip';
import {
  isEntryEnabled as isMcpEnabled,
  selectedTools as selectedMcpTools,
} from '../mcp/mcpCatalog';
import { useMcpCatalog } from '../mcp/useMcpCatalog';
import { McpLogo } from '../mcp/McpLogo';
import {
  isEntryEnabled as isBuiltinEnabled,
  selectedTools as selectedBuiltinTools,
} from '../builtin/builtinCatalog';
import { useBuiltinCatalog } from '../builtin/useBuiltinCatalog';
import { isSubagentSelected } from '../subagent/subagentCatalog';
import { useSubagentCatalog } from '../subagent/useSubagentCatalog';
import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';
import { statusPill, type CallableAgentEntry } from './callableAgentCatalog';

const REASON_MIN = 3;
const REASON_MAX = 1000;
const PROMPT_MAX_HEIGHT = 220;

const Section = ({
  label,
  info,
  children,
}: {
  label: string;
  info: string;
  children: ReactNode;
}): ReactElement => (
  <section className='flex w-full flex-col gap-4'>
    <SectionHeading label={label} info={info} />
    {children}
  </section>
);

const ChipRow = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='flex w-full flex-wrap items-start gap-2.5'>{children}</div>
);

const EmptyHint = ({ children }: { children: ReactNode }): ReactElement => (
  <p className='text-sm font-normal leading-5 text-muted-foreground'>{children}</p>
);

/** The four toolbox lists as stored on the agent's config. */
function readSelection(config: Record<string, unknown> | undefined): Required<ToolboxSelection> {
  const tools = (config?.['tools'] ?? {}) as Record<string, unknown>;
  const read = (key: string): string[] =>
    Array.isArray(tools[key])
      ? (tools[key] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
  return {
    subagents: read('subagents'),
    direct: read('direct'),
    custom: read('custom'),
    gateway: read('gateway'),
  };
}

function readCallableAgents(config: Record<string, unknown> | undefined): string[] {
  const tools = (config?.['tools'] ?? {}) as Record<string, unknown>;
  return Array.isArray(tools['callableAgents'])
    ? (tools['callableAgents'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
}

const toolCountLabel = (count: number): string => `${count} ${count === 1 ? 'tool' : 'tools'}`;

const ChipSection = ({
  label,
  info,
  loading,
  emptyLabel,
  children,
  isEmpty,
}: {
  label: string;
  info: string;
  loading: boolean;
  emptyLabel: string;
  isEmpty: boolean;
  children: ReactNode;
}): ReactElement => (
  <Section label={label} info={info}>
    {isEmpty ? (
      <EmptyHint>{loading ? 'Loading…' : emptyLabel}</EmptyHint>
    ) : (
      <ChipRow>{children}</ChipRow>
    )}
  </Section>
);

export function CallableAgentDetailPanel({
  entry,
  busy,
  onAdd,
  onRemove,
}: {
  entry: CallableAgentEntry;
  busy: boolean;
  onAdd: (requestReason: string) => void;
  onRemove: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  // The catalog row comes from the agent LIST, which carries no config, skills
  // or prompt — fetch the real detail so these sections aren't all empty.
  const detail = useClawAgentDetail(entry.slug);
  const agent = detail.data ?? entry.agent;

  const pill = statusPill(entry.status);
  const added = entry.status !== null;
  const reasonTooShort = entry.needsApproval && reason.trim().length < REASON_MIN;

  const owner = entry.ownerName ?? agent?.owner?.name ?? agent?.owner?.email ?? '';
  const description = agent?.description || entry.description;
  const systemPrompt = agent?.systemPrompt ?? '';
  const selection = readSelection(agent?.config);
  const callableAgents = readCallableAgents(agent?.config);
  // Resolved through the same catalogs the Tools tab uses, so MCP shows the
  // server (Bitbucket, GitHub) with a tool count rather than raw tool ids.
  const mcp = useMcpCatalog();
  const builtin = useBuiltinCatalog();
  const subagentCatalog = useSubagentCatalog();
  const mcpEntries = mcp.entries.filter(candidate => isMcpEnabled(selection, candidate));
  const builtinEntries = builtin.entries.filter(candidate =>
    isBuiltinEnabled(selection, candidate),
  );
  const subagentEntries = subagentCatalog.entries.filter(candidate =>
    isSubagentSelected(selection, candidate),
  );
  const skills = agent?.skills ?? [];
  const collections = agent?.collections ?? [];

  const meta = [
    agent?.modelId || 'Platform default',
    agent?.scope === 'global' ? 'Org-wide' : 'Personal',
    agent && !agent.enabled ? 'Disabled' : null,
  ].filter(Boolean);

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-[22px] pb-9 pt-2'>
      <div className='flex w-full items-start gap-12'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <span
            className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm'
            aria-hidden
          >
            <UserBot className='size-6' />
          </span>
          <div className='flex min-w-0 flex-col gap-2.5 py-px'>
            <span className='flex min-w-0 items-center gap-2'>
              <span className='truncate text-sm font-semibold leading-5 tracking-[-0.28px] text-foreground'>
                {entry.name}
              </span>
              {pill && (
                <Pill tone={pill.tone} size='sm'>
                  {pill.label}
                </Pill>
              )}
            </span>
            <span className='flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
              {owner && (
                <>
                  Built by
                  <span className='truncate text-[color:var(--mention-color)]'>
                    @{owner.replace(/^@+/, '')}
                  </span>
                  ·
                </>
              )}
              {meta.join(' · ')}
            </span>
          </div>
        </div>

        <button
          type='button'
          onClick={() => (added ? onRemove() : onAdd(reason.trim()))}
          disabled={busy || (!added && reasonTooShort)}
          data-track-category='Claw Agents'
          data-track-name={added ? 'RemoveCallableAgent' : 'RequestDelegation'}
          className={cn(
            'flex h-7 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-medium leading-[1.2] transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-50',
            added
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {added ? 'Remove' : entry.needsApproval ? 'Request access' : 'Add'}
        </button>
      </div>

      {description && (
        <p className='w-full text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
          {description}
        </p>
      )}

      <div className='flex w-full flex-col gap-4'>
        {!added && entry.needsApproval && (
          <>
            <Section
              label='Request access'
              info='The owner sees this note when they review the request'
            >
              <div className='flex w-full flex-col gap-2'>
                <Textarea
                  value={reason}
                  maxLength={REASON_MAX}
                  onChange={event => setReason(event.target.value)}
                  placeholder='Why does this agent need to be called?'
                  rows={3}
                />
                <span className='text-xs leading-4 text-muted-foreground'>
                  {owner || 'The owner'} approves before this agent can be called. It runs under
                  whoever started the run, never with its own credentials.
                </span>
              </div>
            </Section>
            <Separator />
          </>
        )}

        <Section label='Instructions' info='The system prompt this agent runs with'>
          {systemPrompt ? (
            <ScrollFadeBox height={PROMPT_MAX_HEIGHT} resetKeys={[entry.slug, systemPrompt]}>
              <p className='whitespace-pre-wrap break-words text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
                {systemPrompt}
              </p>
            </ScrollFadeBox>
          ) : (
            <EmptyHint>{detail.isLoading ? 'Loading…' : 'No instructions shared'}</EmptyHint>
          )}
        </Section>

        <Separator />

        <ChipSection
          label='Subagents'
          info='Specialists this agent can delegate a whole task to'
          loading={detail.isLoading || subagentCatalog.loading}
          emptyLabel='No subagents added yet.'
          isEmpty={subagentEntries.length === 0}
        >
          {subagentEntries.map(item => (
            <TokenChip
              key={item.name}
              icon={
                <ChipIconTile>
                  <UserBot className='size-4' />
                </ChipIconTile>
              }
              label={item.name}
              secondary={item.description}
            />
          ))}
        </ChipSection>

        <Separator />

        <ChipSection
          label='Agents'
          info='Other agents this one can hand a task to'
          loading={detail.isLoading}
          emptyLabel='No agents added yet.'
          isEmpty={callableAgents.length === 0}
        >
          {callableAgents.map(slug => (
            <TokenChip
              key={slug}
              icon={
                <ChipIconTile>
                  <UserBot className='size-4' />
                </ChipIconTile>
              }
              label={`@${slug}`}
            />
          ))}
        </ChipSection>

        <Separator />

        <ChipSection
          label='MCP Tools'
          info='Tools it calls directly on connected integrations'
          loading={detail.isLoading || mcp.loading}
          emptyLabel='No MCP tools added yet.'
          isEmpty={mcpEntries.length === 0}
        >
          {mcpEntries.map(item => (
            <TokenChip
              key={item.slug}
              icon={
                <ChipIconTile>
                  <McpLogo type={item.iconType} name={item.label} size='sm' />
                </ChipIconTile>
              }
              label={item.label}
              secondary={toolCountLabel(selectedMcpTools(selection, item).length)}
            />
          ))}
        </ChipSection>

        <Separator />

        <ChipSection
          label='Built-In tools'
          info='Tools that ship with the platform, no connection needed'
          loading={detail.isLoading || builtin.loading}
          emptyLabel='No built-in tools added yet.'
          isEmpty={builtinEntries.length === 0}
        >
          {builtinEntries.map(item => (
            <TokenChip
              key={item.source}
              icon={
                <ChipIconTile>
                  <Tools className='size-4' />
                </ChipIconTile>
              }
              label={item.label}
              secondary={toolCountLabel(selectedBuiltinTools(selection, item).length)}
            />
          ))}
        </ChipSection>

        <Separator />

        <Section label='Skills' info='Reusable instructions this agent can follow'>
          {skills.length > 0 ? (
            <ChipRow>
              {skills.map(skill => (
                <TokenChip
                  key={skill.id}
                  icon={
                    <ChipIconTile>
                      <Staroflife className='size-4' />
                    </ChipIconTile>
                  }
                  label={skill.skill.name}
                  secondary={skill.skill.description}
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyHint>{detail.isLoading ? 'Loading…' : 'No skills added'}</EmptyHint>
          )}
        </Section>

        <Separator />

        <Section label='Knowledge' info='Sources this agent can read'>
          {agent?.kbScope === 'USER' ? (
            <EmptyHint>Matches the access of whoever runs it</EmptyHint>
          ) : collections.length > 0 ? (
            <EmptyHint>
              {collections.length} {collections.length === 1 ? 'source' : 'sources'} added
            </EmptyHint>
          ) : (
            <EmptyHint>{detail.isLoading ? 'Loading…' : 'No knowledge added'}</EmptyHint>
          )}
        </Section>
      </div>
    </div>
  );
}
