import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Staroflife } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawSkillFiles } from '@/hooks/useClawSkills';
import { ScrollFadeBox } from '../../primitives/ProseBox';
import { SectionHeading } from '../../primitives/Section';
import { SkillFileTree } from './SkillFileTree';
import {
  buildSkillFileTree,
  collectFolderPaths,
  SKILL_MD,
  type SkillTreeFile,
} from './skillFileNodes';
import { useSkillFileContent } from './useSkillFileContent';
import { disableSkill, enableSkill, isSkillSelected, type SkillCatalogEntry } from './skillCatalog';

const PANE_HEIGHT = 298;

const SKILL_MD_NODE: SkillTreeFile = {
  kind: 'file',
  name: SKILL_MD,
  path: SKILL_MD,
  fileId: null,
};

const Body = ({ children }: { children: string }): ReactElement => (
  <p className='whitespace-pre-wrap break-words text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
    {children}
  </p>
);

const Muted = ({ children }: { children: ReactNode }): ReactElement => (
  <p className='text-sm font-normal leading-5 text-muted-foreground'>{children}</p>
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

  const tree = useMemo(() => buildSkillFileTree(files.data ?? []), [files.data]);
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);

  const [closedFolders, setClosedFolders] = useState<ReadonlySet<string>>(new Set());
  const [openFile, setOpenFile] = useState<SkillTreeFile>(SKILL_MD_NODE);

  // Folders start expanded; state records only the ones the user collapsed, so
  // newly loaded folders are open without an effect syncing them in.
  const expanded = useMemo(
    () => new Set(folderPaths.filter(path => !closedFolders.has(path))),
    [folderPaths, closedFolders],
  );

  const toggleFolder = (path: string): void => {
    setClosedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const isSkillMd = openFile.fileId === null;
  const fileContent = useSkillFileContent(entry.slug, openFile.fileId);
  const preview = isSkillMd ? entry.skill.content : fileContent.content;

  const email = entry.skill.owner?.email ?? null;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-[22px] pb-9 pt-2'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <span
            className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm'
            aria-hidden
          >
            <Staroflife className='size-6' />
          </span>
          <div className='flex min-w-0 flex-col gap-1.5 py-px'>
            <span className='truncate text-sm font-semibold leading-[1.3] tracking-[-0.28px] text-foreground'>
              /{entry.label}
            </span>
            <span className='truncate text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
              Created by{' '}
              {email ? (
                <a href={`mailto:${email}`} className='underline underline-offset-2'>
                  {entry.ownerName ?? email}
                </a>
              ) : (
                <span className='underline underline-offset-2'>{entry.ownerName ?? 'Unknown'}</span>
              )}
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
              : 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {selected ? 'Remove' : 'Add'}
        </button>
      </div>

      {entry.description && (
        <p className='w-full text-sm font-normal leading-[1.3] tracking-[-0.28px] text-foreground'>
          {entry.description}
        </p>
      )}

      <div className='flex w-full flex-col gap-4'>
        <section className='flex w-full flex-col gap-4'>
          <SectionHeading label='Files' />

          {files.isLoading ? (
            <div className='flex w-full flex-col gap-2'>
              <Skeleton className='h-9 w-48' />
              <Skeleton className='h-9 w-40' />
            </div>
          ) : (
            <div className='flex w-full items-stretch gap-4'>
              <div className='w-[190px] shrink-0'>
                <SkillFileTree
                  nodes={tree}
                  selectedPath={openFile.path}
                  onSelect={setOpenFile}
                  openFolders={expanded}
                  onToggleFolder={toggleFolder}
                />
              </div>

              <div className='min-w-0 flex-1'>
                <ScrollFadeBox height={PANE_HEIGHT} resetKeys={[preview, openFile.path]}>
                  {!isSkillMd && fileContent.loading ? (
                    <div className='flex flex-col gap-2'>
                      <Skeleton className='h-4 w-full' />
                      <Skeleton className='h-4 w-4/5' />
                      <Skeleton className='h-4 w-2/3' />
                    </div>
                  ) : !isSkillMd && fileContent.isError ? (
                    <Muted>Couldn&apos;t load {openFile.name}.</Muted>
                  ) : preview ? (
                    <Body>{preview}</Body>
                  ) : (
                    <Muted>{openFile.name} is empty.</Muted>
                  )}
                </ScrollFadeBox>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
