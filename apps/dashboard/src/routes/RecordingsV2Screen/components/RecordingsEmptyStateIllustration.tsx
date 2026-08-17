import type { ReactElement } from 'react';

const PreviewLine = ({
  x,
  y,
  width,
  height = 4,
  opacity = 0.28,
}: {
  x: number;
  y: number;
  width: number;
  height?: number;
  opacity?: number;
}): ReactElement => (
  <rect
    x={x}
    y={y}
    width={width}
    height={height}
    rx={height / 2}
    fill='hsl(var(--muted-foreground))'
    opacity={opacity}
  />
);

/**
 * Square previews of the recordings list and recording detail surfaces.
 * Colors map exclusively to semantic tokens from global.css.
 */
export function RecordingsEmptyStateIllustration(): ReactElement {
  return (
    <svg viewBox='0 0 188 166' fill='none' className='h-auto w-52 max-w-full' aria-hidden='true'>
      <g transform='rotate(-8 83 68)'>
        <rect
          x='29'
          y='14'
          width='108'
          height='108'
          rx='16'
          fill='var(--sidebar-accent)'
          fillOpacity='0.8'
          stroke='var(--sidebar-border)'
          strokeOpacity='0.55'
        />

        <PreviewLine x={43} y={31} width={37} height={5} opacity={0.16} />
        <PreviewLine x={43} y={47} width={69} opacity={0.12} />
        <PreviewLine x={43} y={57} width={55} opacity={0.1} />
        <PreviewLine x={43} y={77} width={76} opacity={0.1} />
        <PreviewLine x={43} y={87} width={62} opacity={0.1} />
      </g>

      <rect
        x='49'
        y='34'
        width='108'
        height='108'
        rx='16'
        fill='hsl(var(--card))'
        stroke='var(--sidebar-border)'
        strokeOpacity='0.75'
      />

      <circle cx='65' cy='52' r='3' fill='var(--sidebar-primary)' opacity='0.9' />
      <PreviewLine x={74} y={50} width={39} height={4} opacity={0.22} />

      <PreviewLine x={63} y={69} width={71} height={5} opacity={0.3} />
      <PreviewLine x={63} y={79} width={54} height={5} opacity={0.26} />

      <PreviewLine x={63} y={99} width={78} opacity={0.18} />
      <PreviewLine x={63} y={108} width={65} opacity={0.16} />

      <path d='M63 121H143' stroke='var(--sidebar-border)' strokeLinecap='round' />
      <PreviewLine x={63} y={130} width={26} height={3.5} opacity={0.16} />
      <PreviewLine x={120} y={130} width={23} height={3.5} opacity={0.22} />
    </svg>
  );
}
