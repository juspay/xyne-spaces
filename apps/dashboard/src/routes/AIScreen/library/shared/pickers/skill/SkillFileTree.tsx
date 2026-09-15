import { type ReactElement } from 'react';
import { ChevronDown, ChevronRight, FolderDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import type { SkillTreeNode } from './skillFileNodes';

const ROW = 'flex w-full items-center rounded-[10px] px-3 py-2 text-left transition-colors';
const LABEL = 'min-w-0 truncate text-sm font-normal leading-5 tracking-[-0.28px] text-foreground';

interface SkillFileTreeProps {
  nodes: readonly SkillTreeNode[];
  selectedPath: string;
  onSelect: (node: Extract<SkillTreeNode, { kind: 'file' }>) => void;
  openFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
}

export function SkillFileTree({
  nodes,
  selectedPath,
  onSelect,
  openFolders,
  onToggleFolder,
}: SkillFileTreeProps): ReactElement {
  return (
    <div className='flex w-full flex-col gap-2'>
      {nodes.map(node =>
        node.kind === 'folder' ? (
          <div key={node.path} className='flex w-full flex-col gap-2'>
            <button
              type='button'
              onClick={() => onToggleFolder(node.path)}
              aria-expanded={openFolders.has(node.path)}
              data-track-category='Claw Agents'
              data-track-name='Create agent v2: toggle skill folder'
              className={cn(ROW, 'justify-between gap-2 hover:bg-muted/60')}
            >
              <span className='flex min-w-0 items-center gap-2'>
                <FolderDefault className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                <span className={LABEL}>{node.name}</span>
              </span>
              {openFolders.has(node.path) ? (
                <ChevronDown className='size-4 shrink-0 text-muted-foreground' aria-hidden />
              ) : (
                <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
              )}
            </button>

            {openFolders.has(node.path) && node.children.length > 0 && (
              <div className='ml-3 border-l border-border pl-3'>
                <SkillFileTree
                  nodes={node.children}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  openFolders={openFolders}
                  onToggleFolder={onToggleFolder}
                />
              </div>
            )}
          </div>
        ) : (
          <button
            key={node.path}
            type='button'
            onClick={() => onSelect(node)}
            aria-current={node.path === selectedPath ? 'true' : undefined}
            title={node.path}
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: open skill file'
            className={cn(ROW, node.path === selectedPath ? 'bg-muted' : 'hover:bg-muted/60')}
          >
            <span className={LABEL}>{node.name}</span>
          </button>
        ),
      )}
    </div>
  );
}
