import type { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';
import { Tooltip } from '../../ui/Tooltip';
import { shapeStyle, type BoxShape } from './TopicsExplorer.utils';

/** One box: a group's label plus its pre-formatted count and share. */
export interface TopicTile {
  name: string;
  nodeKey: string;
  colour: string;
  /** Foreground that passes contrast on `colour` — see readableOn(). */
  ink: string;
  count: string;
  /** Empty when the level's groups overlap, where a percentage would mislead. */
  share: string;
  sharePct: number;
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

/** The left-hand mosaic: one clipped box per group, sized by the template. */
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
      // A 1-row box is ~45px but label + count + bar needs ~68px and would clip.
      // Degrade to label-only; count and share stay in the aria-label and tooltip.
      const isShort = shape.h <= 1;
      const label = `${tile.name}: ${tile.count}${
        tile.share ? `, ${tile.share} of tickets at this level` : ''
      }. ${drillable ? 'Opens sub-groups' : 'Opens ticket list'}`;
      return (
        // Shared Tooltip: it portals out of the transformed dialog and handles
        // collisions, which a hand-rolled fixed-position card had to do itself.
        <Tooltip
          key={tile.nodeKey}
          side='bottom'
          delayDuration={80}
          content={
            <span className='block max-w-[260px]'>
              {/* Wraps, not truncates: the full name is why this exists. */}
              <span className='block break-words font-semibold'>{tile.name}</span>
              <span className='mt-0.5 block text-muted-foreground'>
                {tile.share ? `${tile.count} · ${tile.share}` : tile.count}
              </span>
              <span className='mt-0.5 block text-muted-foreground'>
                {drillable ? 'Click to drill down' : 'Click to open tickets'}
              </span>
            </span>
          }
        >
          <button
            type='button'
            onClick={() => onSelect(tile.nodeKey)}
            onMouseEnter={() => onHover(tile.nodeKey)}
            onFocus={() => onHover(tile.nodeKey)}
            onMouseLeave={() => onHover(null)}
            onBlur={() => onHover(null)}
            className={cn(
              'absolute flex min-w-0 flex-col justify-between overflow-hidden p-3 text-left',
              'outline-none transition-[filter] duration-150',
              isHovered && 'z-10',
            )}
            style={{
              ...shapeStyle(shape),
              padding: isShort ? '6px 10px' : '12px',
              borderRadius: 10,
              background: tile.colour,
              color: tile.ink,
              // Inset ring, not `outline`: clip-path clips outlines, so a notched
              // box loses its focus indicator.
              boxShadow: isHovered ? `inset 0 0 0 3px ${tile.ink}` : undefined,
              filter: isHovered ? 'brightness(1.08)' : undefined,
            }}
            aria-label={label}
            data-track-category='TOPICS_EXPLORER'
            data-track-name='SELECT_TOPIC_TILE'
          >
            <span className='min-w-0'>
              <span className='block truncate text-sm font-semibold'>{tile.name}</span>
              {!isShort && (
                <span className='mt-0.5 block truncate text-xs opacity-90'>
                  {tile.share ? `${tile.count} · ${tile.share}` : tile.count}
                </span>
              )}
            </span>

            {/* Inherits the tile's foreground so it stays visible on light swatches. */}
            {!isShort && (
              <span
                className='mt-2 block h-1.5 w-full overflow-hidden rounded-full'
                style={{ backgroundColor: 'currentColor', opacity: 0.25 }}
              >
                <span
                  className='block h-full rounded-full'
                  style={{
                    width: `${Math.max(tile.sharePct, 2)}%`,
                    backgroundColor: 'currentColor',
                  }}
                />
              </span>
            )}
          </button>
        </Tooltip>
      );
    })}
  </div>
);
