import { useId } from 'react';
import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import { useClawTabStatus } from './ClawConversationContext';

interface ClawMarkProps {
  size?: number;
  className?: string;
}

const INK = '#331306';

type Expression = 'idle' | 'thinking' | 'happy' | 'sad';

export function ClawMark({ size = 20, className }: ClawMarkProps): ReactElement {
  const { isStreaming, hasUnseenAnswer, hasError } = useClawTabStatus();
  const expression: Expression = isStreaming
    ? 'thinking'
    : hasError
      ? 'sad'
      : hasUnseenAnswer
        ? 'happy'
        : 'idle';

  const gradientId = `claw-blob-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const dotEyes = expression !== 'happy';
  const blink = expression === 'idle' || expression === 'thinking';
  const eyeCy = expression === 'sad' ? 19.8 : 19;
  const eyeR = expression === 'sad' ? 2 : 2.3;

  const motionClass =
    expression === 'thinking'
      ? 'claw-mark--bob-fast'
      : expression === 'happy'
        ? 'claw-mark--hop'
        : expression === 'sad'
          ? 'claw-mark--wobble'
          : 'claw-mark--bob-slow';

  return (
    <span className={cn('claw-mark-wrap inline-flex shrink-0 select-none', className)}>
      <svg
        width={size}
        height={size}
        viewBox='0 0 40 40'
        aria-hidden='true'
        data-expression={expression}
        style={expression === 'sad' ? { opacity: 0.92 } : undefined}
        className={cn('claw-mark-blob', motionClass)}
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1='20'
            y1='6'
            x2='20'
            y2='36'
            gradientUnits='userSpaceOnUse'
          >
            <stop stopColor='#FFA24D' />
            <stop offset='1' stopColor='#ED6252' />
          </linearGradient>
        </defs>

        <rect x='5' y='6' width='30' height='30' rx='12' fill={`url(#${gradientId})`} />
        <ellipse cx='14' cy='13' rx='5' ry='3' fill='#FFEAD6' opacity='0.28' />

        {expression === 'thinking' && (
          <g aria-hidden='true'>
            {[
              { cx: 33.2, cy: 8.4, r: 1.2, delay: '0s' },
              { cx: 36.2, cy: 5.6, r: 1.6, delay: '0.35s' },
              { cx: 38.2, cy: 2.4, r: 1.1, delay: '0.7s' },
            ].map(dot => (
              <circle
                key={dot.cx}
                cx={dot.cx}
                cy={dot.cy}
                r={dot.r}
                fill='#FF8904'
                className='claw-think-dot'
                style={{
                  animationDelay: dot.delay,
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                }}
              />
            ))}
          </g>
        )}

        {dotEyes ? (
          <g
            className={cn(expression === 'thinking' && 'claw-eyes--glance')}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            {[15.5, 24.5].map(cx => (
              <g
                key={cx}
                className={cn(blink && 'claw-eye--blink')}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                <circle cx={cx} cy={eyeCy} r={eyeR} fill={INK} />
                <circle cx={cx + 0.8} cy={eyeCy - 1} r='0.7' fill='#FFEFE0' opacity='0.9' />
              </g>
            ))}
          </g>
        ) : (
          <>
            <path
              d='M13.4 19.4 Q15.5 17.2 17.6 19.4'
              fill='none'
              stroke={INK}
              strokeWidth='1.9'
              strokeLinecap='round'
            />
            <path
              d='M22.4 19.4 Q24.5 17.2 26.6 19.4'
              fill='none'
              stroke={INK}
              strokeWidth='1.9'
              strokeLinecap='round'
            />
          </>
        )}

        {expression === 'thinking' ? (
          <rect
            className='claw-mouth--thinking'
            x='18'
            y='25.6'
            width='4'
            height='1.9'
            rx='0.95'
            fill={INK}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        ) : expression === 'happy' ? (
          <path
            d='M15.8 25.2 Q20 29.6 24.2 25.2'
            fill='none'
            stroke={INK}
            strokeWidth='1.9'
            strokeLinecap='round'
          />
        ) : expression === 'sad' ? (
          <path
            d='M16.2 27.8 Q20 24.8 23.8 27.8'
            fill='none'
            stroke={INK}
            strokeWidth='1.7'
            strokeLinecap='round'
          />
        ) : (
          <path
            d='M16.8 26 Q20 27.7 23.2 26'
            fill='none'
            stroke={INK}
            strokeWidth='1.7'
            strokeLinecap='round'
          />
        )}
      </svg>
    </span>
  );
}
