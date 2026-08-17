import { type ReactElement, type ReactNode } from 'react';
import { Staroflife, Tools, UserBot } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { McpLogo } from '../mcp/McpLogo';
import { Clamped } from '../../primitives/Clamped';
import { ScrollFadeBox } from '../../primitives/ProseBox';
import { SectionHeading, Separator } from '../../primitives/Section';
import { ChipIconTile, TokenChip } from '../../primitives/TokenChip';
import { resolveSubagentCapabilities } from './subagentDetail';
import { useSubagentDetail } from './useSubagentDetail';
import {
  disableSubagent,
  enableSubagent,
  isSubagentSelected,
  type SubagentCatalogEntry,
  type SubagentSelection,
} from './subagentCatalog';

const PROMPT_MAX_HEIGHT = 300;
const TOOLS_MAX_HEIGHT = 175;

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

const Field = ({
  label,
  value,
  leading,
}: {
  label: string;
  value: string;
  leading: 'tight' | 'relaxed';
}): ReactElement => (
  <div className='flex w-full flex-col gap-2'>
    <span className='text-xs font-medium capitalize leading-4 tracking-[0.48px] text-muted-foreground'>
      {label}
    </span>
    <span
      className={cn(
        'text-sm font-medium text-foreground',
        leading === 'tight' ? 'leading-[1.2]' : 'leading-[1.3]',
      )}
    >
      {value}
    </span>
  </div>
);

interface SubagentDetailPanelProps {
  entry: SubagentCatalogEntry;
  selection: SubagentSelection;
  onSelectionChange: (next: SubagentSelection) => void;
}

export function SubagentDetailPanel({
  entry,
  selection,
  onSelectionChange,
}: SubagentDetailPanelProps): ReactElement {
  const selected = isSubagentSelected(selection, entry);
  const availableTools = useClawAvailableTools();
  const { def } = useSubagentDetail(entry.name, entry.def);

  const capabilities = resolveSubagentCapabilities(
    availableTools.data ?? null,
    def,
    entry.serverType,
  );
  const author = def?.createdByName || def?.createdByEmail || '';
  const contributors = def?.shares ?? [];
  const skills = def?.skills ?? [];
  const systemPrompt = def?.systemPrompt ?? '';
  const description = def?.description || entry.description;

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
            <span className='truncate text-sm font-semibold leading-5 tracking-[-0.28px] text-foreground'>
              {entry.name}
            </span>
            {author && (
              <span className='truncate text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
                Created by {author}
              </span>
            )}
          </div>
        </div>
        <button
          type='button'
          onClick={() =>
            onSelectionChange(
              selected ? disableSubagent(selection, entry) : enableSubagent(selection, entry),
            )
          }
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: toggle subagent from detail'
          className={cn(
            'flex h-7 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-medium leading-[1.2] transition-colors',
            selected
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {selected ? 'Remove' : 'Add'}
        </button>
      </div>

      {description && (
        <p className='w-full text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
          {description}
        </p>
      )}

      <div className='flex w-full flex-col gap-4'>
        <Section label='Instructions' info='The system prompt this subagent runs with'>
          {systemPrompt ? (
            <ScrollFadeBox height={PROMPT_MAX_HEIGHT} resetKeys={[entry.name, systemPrompt]}>
              <p className='whitespace-pre-wrap break-words text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
                {systemPrompt}
              </p>
            </ScrollFadeBox>
          ) : (
            <EmptyHint>No instructions added</EmptyHint>
          )}
        </Section>

        <Separator />

        <Section label='Contributors' info='People who can edit this subagent'>
          {contributors.length > 0 ? (
            <ChipRow>
              {contributors.map(share => (
                <TokenChip
                  key={share.userId}
                  icon={
                    <ChipIconTile>
                      <UserBot className='size-4' />
                    </ChipIconTile>
                  }
                  label={share.name || share.email}
                  secondary={share.email}
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyHint>No contributors added</EmptyHint>
          )}
        </Section>

        <Separator />

        <Section label='Parameter' info='What the parent agent passes in when it delegates'>
          {def?.paramName || def?.paramDescription ? (
            <>
              {def.paramName && <Field label='Name' value={def.paramName} leading='tight' />}
              {def.paramDescription && (
                <Field label='Description' value={def.paramDescription} leading='relaxed' />
              )}
            </>
          ) : (
            <EmptyHint>No parameter defined</EmptyHint>
          )}
        </Section>

        <Separator />

        <Section label='MCP' info='Connectors this subagent draws its tools from'>
          {capabilities.mcps.length > 0 ? (
            <ChipRow>
              {capabilities.mcps.map(mcp => (
                <TokenChip
                  key={mcp.slug}
                  icon={<McpLogo type={mcp.slug} name={mcp.label} />}
                  label={mcp.label}
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyHint>No MCP connected</EmptyHint>
          )}
        </Section>

        <Separator />

        <Section label='Built-in Tools' info='Platform tools this subagent can call'>
          {capabilities.builtinTools.length > 0 ? (
            <Clamped maxHeight={TOOLS_MAX_HEIGHT} resetKey={entry.name}>
              <ChipRow>
                {capabilities.builtinTools.map(tool => (
                  <TokenChip
                    key={tool.key}
                    icon={
                      <ChipIconTile>
                        <Tools className='size-4' />
                      </ChipIconTile>
                    }
                    label={tool.label}
                  />
                ))}
              </ChipRow>
            </Clamped>
          ) : (
            <EmptyHint>No built-in tools added</EmptyHint>
          )}
        </Section>

        <Separator />

        <Section label='System Tools' info='Custom tool groups registered for this workspace'>
          {capabilities.systemTools.length > 0 ? (
            <ChipRow>
              {capabilities.systemTools.map(tool => (
                <TokenChip
                  key={tool.key}
                  icon={
                    <ChipIconTile>
                      <Tools className='size-4' />
                    </ChipIconTile>
                  }
                  label={tool.label}
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyHint>No system tools added</EmptyHint>
          )}
        </Section>

        <Separator />

        <Section label='Skills' info='Reference material this subagent consults'>
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
                  label={skill.name}
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyHint>No skills added</EmptyHint>
          )}
        </Section>
      </div>

      {author && (
        <p className='w-full pt-9 text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
          Created by {author}
        </p>
      )}
    </div>
  );
}
