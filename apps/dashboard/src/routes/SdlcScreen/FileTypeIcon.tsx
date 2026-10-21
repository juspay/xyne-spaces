/**
 * An uploaded file's icon: the mark its format is known by — PDF, Markdown's M↓,
 * Word's W — on a soft tint of that format's colour. Recognisable at
 * a glance, but quiet enough to sit in a list of neutral rows.
 */
import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import type { FileKind, FileTone } from './fileKind';

// A lighter ink in the midnight theme, where the light theme's would sink into the tint.
const TONE_CLASS: Record<FileTone, { tint: string; ink: string }> = {
  red: { tint: 'bg-red-500/15', ink: 'text-red-600 [[data-theme=midnight]_&]:text-red-400' },
  blue: { tint: 'bg-blue-500/15', ink: 'text-blue-600 [[data-theme=midnight]_&]:text-blue-400' },
  green: {
    tint: 'bg-emerald-500/15',
    ink: 'text-emerald-600 [[data-theme=midnight]_&]:text-emerald-400',
  },
  orange: {
    tint: 'bg-orange-500/15',
    ink: 'text-orange-600 [[data-theme=midnight]_&]:text-orange-400',
  },
  slate: {
    tint: 'bg-slate-500/15',
    ink: 'text-slate-600 [[data-theme=midnight]_&]:text-slate-300',
  },
  violet: {
    tint: 'bg-violet-500/15',
    ink: 'text-violet-600 [[data-theme=midnight]_&]:text-violet-400',
  },
  amber: {
    tint: 'bg-amber-500/15',
    ink: 'text-amber-600 [[data-theme=midnight]_&]:text-amber-400',
  },
  pink: { tint: 'bg-pink-500/15', ink: 'text-pink-600 [[data-theme=midnight]_&]:text-pink-400' },
  teal: { tint: 'bg-teal-500/15', ink: 'text-teal-600 [[data-theme=midnight]_&]:text-teal-400' },
  gray: { tint: 'bg-foreground/[0.07]', ink: 'text-muted-foreground' },
};

/** Marks by length — one letter, two, three — so a longer one still fits the tile. */
const SIZE_CLASS = {
  /** Trees and tabs, beside 13px type. */
  sm: {
    tile: 'size-4 rounded-[4px]',
    glyph: 'size-2.5',
    mark: ['text-[9px]', 'text-[7.5px]', 'text-[6px]'],
  },
  /** List rows. */
  md: {
    tile: 'size-5 rounded-[5px]',
    glyph: 'size-3',
    mark: ['text-[11px]', 'text-[9px]', 'text-[7.5px]'],
  },
  /** Where a file stands alone, with nothing to preview. */
  lg: {
    tile: 'size-12 rounded-xl',
    glyph: 'size-6',
    mark: ['text-[22px]', 'text-[17px]', 'text-[13px]'],
  },
} as const;

function markClass(marks: readonly [string, string, string], mark: string): string {
  // Counted by code point, so the arrow in M↓ is one character.
  const length = [...mark].length;
  return marks[Math.min(length, 3) - 1] ?? marks[2];
}

export function FileTypeIcon(props: {
  kind: FileKind;
  size?: keyof typeof SIZE_CLASS;
  /** Just the mark in its colour, for places too small for a tile to read, such as
   *  an 11px badge. Size it with `className`. */
  bare?: boolean;
  className?: string | undefined;
}): ReactElement {
  const size = SIZE_CLASS[props.size ?? 'md'];
  const tone = TONE_CLASS[props.kind.tone];
  const Icon = props.kind.icon;
  if (props.bare) {
    return (
      <span
        aria-hidden='true'
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          tone.ink,
          props.className,
        )}
      >
        {props.kind.mark ? (
          <span
            className={cn(
              'font-bold leading-none',
              markClass(['text-[10px]', 'text-[8px]', 'text-[6.5px]'], props.kind.mark),
            )}
          >
            {props.kind.mark}
          </span>
        ) : (
          <Icon className='size-full' />
        )}
      </span>
    );
  }
  return (
    <span
      aria-hidden='true'
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        size.tile,
        tone.tint,
        tone.ink,
        props.className,
      )}
    >
      {props.kind.mark ? (
        <span
          className={cn(
            'font-bold leading-none tracking-tight',
            markClass(size.mark, props.kind.mark),
          )}
        >
          {props.kind.mark}
        </span>
      ) : (
        <Icon className={size.glyph} />
      )}
    </span>
  );
}
