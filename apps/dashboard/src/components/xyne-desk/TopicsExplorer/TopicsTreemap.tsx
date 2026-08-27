import type { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';
import { Tooltip } from '../../ui/Tooltip';
import { shapeStyle, type BoxShape } from './TopicsExplorer.utils';

/** One box: a group's label plus its pre-formatted count and share. */
export interface TopicTile {
  name: string;
  nodeKey: string;
  /** Purple shade for this rank, with its paired foreground. */
  fill: string;
  ink: string;
  count: string;
  /** Empty when the level's groups overlap, where a percentage would mislead. */
  share: string;
  sharePct: number;
  /** False when clicking would do nothing: a leaf the ticket list cannot express. */
  canOpen: boolean;
}

export interface TopicsTreemapProps {
  tiles: TopicTile[];
  /** Cell geometry per tile, positionally matched to `tiles`. */
  layout: BoxShape[];
  hovered: string | null;
  /** True when a click opens sub-groups rather than the ticket list. */
  drillable: boolean;
  onSelect: (nodeKey: string) => void;
  /** Drives the shared highlight with the trend panel. */
  onHover: (nodeKey: string | null) => void;
}

/** The left-hand mosaic: one box per group, placed and sized by the template. */
export const TopicsTreemap = ({
  tiles,
  layout,
  hovered,
  drillable,
  onSelect,
  onHover,
}: TopicsTreemapProps): ReactElement => (
  <div className='relative h-full w-full'>
    {tiles.map((tile, i) => {
      const isHovered = hovered === tile.nodeKey;
      const shape = layout[i];
      if (!shape) return null;
      const interactive = drillable || tile.canOpen;
      const action = drillable
        ? 'Opens sub-groups'
        : tile.canOpen
          ? 'Opens ticket list'
          : 'Grouping only — the ticket list has no filter for this field';
      const label = `${tile.name}: ${tile.count}${
        tile.share ? `, ${tile.share} of tickets at this level` : ''
      }. ${action}`;
      return (
        // Shared Tooltip: it portals out of the transformed dialog and handles collisions.
        <Tooltip
          key={tile.nodeKey}
          side='bottom'
          delayDuration={80}
          content={
            <span className='block max-w-[260px]'>
              {/* Wraps rather than truncates: the full name is why this exists. */}
              <span className='block break-words font-semibold'>{tile.name}</span>
              <span className='mt-0.5 block text-muted-foreground'>
                {tile.share ? `${tile.count} · ${tile.share}` : tile.count}
              </span>
              <span className='mt-0.5 block text-muted-foreground'>
                {drillable
                  ? 'Click to drill down'
                  : tile.canOpen
                    ? 'Click to open tickets'
                    : 'Grouping only — no ticket-list filter for this field'}
              </span>
            </span>
          }
        >
          <button
            type='button'
            // Still focusable and hoverable when inert, so the shared highlight
            // with the trend panel keeps working; only the action is withheld.
            onClick={interactive ? (): void => onSelect(tile.nodeKey) : undefined}
            aria-disabled={!interactive}
            onMouseEnter={() => onHover(tile.nodeKey)}
            onFocus={() => onHover(tile.nodeKey)}
            onMouseLeave={() => onHover(null)}
            onBlur={() => onHover(null)}
            className={cn(
              'absolute flex min-w-0 flex-col justify-between overflow-hidden rounded-[10px] p-3 text-left',
              'outline-none transition-[filter] duration-150',
              // A dashed edge marks a tile that does nothing when clicked: the
              // cursor alone left sighted users to find out by clicking, where
              // the aria-label already says so. Not opacity — fading the tile
              // blends fill and ink toward the panel and breaks the palette's
              // paired AA contrast.
              interactive ? 'cursor-pointer' : 'cursor-default border-2 border-dashed',
              isHovered && 'z-10',
            )}
            style={{
              ...shapeStyle(shape),
              background: tile.fill,
              color: tile.ink,
              ...(interactive ? {} : { borderColor: tile.ink }),
              // Inset ring so the focus/hover indicator sits inside the tile's own bounds.
              boxShadow: isHovered ? `inset 0 0 0 3px ${tile.ink}` : undefined,
              filter: isHovered ? 'brightness(1.08)' : undefined,
            }}
            aria-label={label}
            data-track-category='TOPICS_EXPLORER'
            // Only on a tile that does something: otherwise the funnel counts
            // clicks that were never actions.
            data-track-name={interactive ? 'SELECT_TOPIC_TILE' : undefined}
          >
            <span className='min-w-0'>
              <span className='block truncate text-sm font-semibold'>{tile.name}</span>
              <span className='mt-0.5 block truncate text-xs opacity-90'>
                {tile.share ? `${tile.count} · ${tile.share}` : tile.count}
              </span>
            </span>

            {/* Inherits the tile's foreground so it stays visible on light swatches. */}
            <span
              className='mt-2 block h-1.5 w-full overflow-hidden rounded-full'
              style={{ backgroundColor: 'currentColor', opacity: 0.25 }}
            >
              <span
                className='block h-full rounded-full'
                style={{ width: `${Math.max(tile.sharePct, 2)}%`, backgroundColor: 'currentColor' }}
              />
            </span>
          </button>
        </Tooltip>
      );
    })}
  </div>
);
