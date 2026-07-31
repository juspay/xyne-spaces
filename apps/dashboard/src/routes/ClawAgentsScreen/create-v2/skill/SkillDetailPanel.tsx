import { type ReactElement, type ReactNode } from 'react';
import { Notebook } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawSkillFiles } from '@/hooks/useClawSkills';
import { Pill } from '../shared/Pill';
import { SectionHeading, Separator } from '../shared/Section';
import { disableSkill, enableSkill, isSkillSelected, type SkillCatalogEntry } from './skillCatalog';

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const MetaRow = ({ label, children }: { label: string; children: ReactNode }): ReactElement => (
  <div className='flex min-h-7 items-center justify-between gap-3'>
    <span className='text-sm font-medium leading-5 text-muted-foreground'>{label}</span>
    <span className='flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-foreground'>
      {children}
    </span>
  </div>
);

interface SkillDetailPanelProps {
  entry: SkillCatalogEntry;
  selectedIds: readonly string[];
  onChange: (next: string[]) => void;
}

export function SkillDetailPanel({
  entry,
  selectedIds,
  onChange,
}: SkillDetailPanelProps): ReactElement {
  const selected = isSkillSelected(selectedIds, entry);
  const files = useClawSkillFiles(entry.slug);
  const bundle = files.data ?? [];

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-[22px] pb-9 pt-2'>
      <div className='flex w-full items-start gap-12'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <span className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground'>
            <Notebook className='size-5' aria-hidden />
          </span>
          <div className='flex min-w-0 flex-col gap-2.5 py-px'>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='truncate text-sm font-semibold leading-5 tracking-[-0.28px] text-foreground'>
                {entry.label}
              </span>
              <Pill tone='neutral' size='sm'>
                {entry.scope === 'global' ? 'Global' : 'Personal'}
              </Pill>
            </span>
            <span className='truncate text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
              {entry.description || entry.slug}
            </span>
          </div>
        </div>
        <button
          type='button'
          onClick={() =>
            onChange(selected ? disableSkill(selectedIds, entry) : enableSkill(selectedIds, entry))
          }
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: toggle skill from detail'
          className={cn(
            'flex h-7 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-medium leading-[1.2] transition-colors',
            selected
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-border bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {selected ? 'Disable' : 'Enable'}
        </button>
      </div>

      <Separator />

      <section className='flex flex-col gap-4'>
        <SectionHeading label='Details' info='Where this skill comes from and who can use it' />
        <div className='flex flex-col gap-2'>
          <MetaRow label='Handle'>{entry.slug}</MetaRow>
          <MetaRow label='Scope'>
            <Pill tone='neutral'>{entry.scope === 'global' ? 'Global' : 'Personal'}</Pill>
          </MetaRow>
          <MetaRow label='Source'>{entry.source}</MetaRow>
          {entry.ownerName && <MetaRow label='Owner'>{entry.ownerName}</MetaRow>}
          <MetaRow label='Status'>
            {entry.enabled ? (
              <Pill tone='success'>Enabled</Pill>
            ) : (
              <Pill tone='neutral'>Disabled</Pill>
            )}
          </MetaRow>
        </div>
      </section>

      <Separator />

      <section className='flex flex-col gap-4'>
        <SectionHeading label='Instructions' info='The SKILL.md this agent will read' />
        {entry.skill.content ? (
          <pre className='max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 font-mono text-xs font-normal leading-5 text-muted-foreground'>
            {entry.skill.content}
          </pre>
        ) : (
          <p className='text-sm font-normal leading-5 text-muted-foreground'>
            This skill has no instructions yet.
          </p>
        )}
      </section>

      {(files.isLoading || bundle.length > 0) && (
        <>
          <Separator />
          <section className='flex flex-col gap-4'>
            <SectionHeading label='Files' info='Extra files bundled with this skill' />
            {files.isLoading ? (
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-4 w-48' />
                <Skeleton className='h-4 w-36' />
              </div>
            ) : (
              <div className='flex flex-col gap-2'>
                {bundle.map(file => (
                  <MetaRow key={file.id} label={file.relativePath}>
                    {formatFileSize(file.sizeBytes)}
                  </MetaRow>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
