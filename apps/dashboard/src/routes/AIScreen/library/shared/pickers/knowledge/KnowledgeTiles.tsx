import { type ReactElement } from 'react';
import { FolderDefault, Hashtag } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import type { KbCollectionNode } from '@/services/claw/clawKnowledgeBaseTypes';
import { describeFile, type KbIconComponent } from './knowledgeTree';

const TILE = {
  sm: { box: 'size-7 rounded-lg', glyph: 'size-4' },
  md: { box: 'size-9 rounded-[10px]', glyph: 'size-5' },
  lg: { box: 'size-11 rounded-xl', glyph: 'size-[25px]' },
} as const;

export type KbTileSize = keyof typeof TILE;

function Tile({ icon, size }: { icon: KbIconComponent; size: KbTileSize }): ReactElement {
  const Glyph = icon;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center border-[0.8px] border-border bg-card text-muted-foreground shadow-sm',
        TILE[size].box,
      )}
      aria-hidden
    >
      <Glyph className={TILE[size].glyph} />
    </span>
  );
}

export function KbFolderTile({ size = 'md' }: { size?: KbTileSize }): ReactElement {
  return <Tile icon={FolderDefault} size={size} />;
}

export function KbFileTile({
  name,
  size = 'md',
}: {
  name: string;
  size?: KbTileSize;
}): ReactElement {
  return <Tile icon={describeFile(name).icon} size={size} />;
}

/**
 * `# channel · Project name` — the spaces coordinates that tell two similarly
 * named collections apart.
 */
export function KbCollectionMeta({ node }: { node: KbCollectionNode }): ReactElement | null {
  const channel = node.channelName;
  const project = node.projectName;
  if (!channel && !project) return null;

  return (
    <span className='flex min-w-0 items-center gap-3 text-xs leading-4 tracking-[-0.24px]'>
      {channel && (
        <span className='flex min-w-0 items-center gap-1 text-muted-foreground'>
          <Hashtag className='size-3 shrink-0' aria-hidden />
          <span className='truncate'>{channel}</span>
        </span>
      )}
      {project && (
        <span className='flex min-w-0 items-center gap-1'>
          <span className='shrink-0 text-muted-foreground/60'>Project</span>
          <span className='truncate text-muted-foreground'>{project}</span>
        </span>
      )}
    </span>
  );
}
