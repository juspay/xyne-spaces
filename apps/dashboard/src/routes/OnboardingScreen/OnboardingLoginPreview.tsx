import type { ReactElement } from 'react';

const IMG_ASPECT = 891.43 / 1040.85;
/** Figma 304:7887 top overflow 98.92px / image height 1040.85 */
const TOP_VISIBLE = 1 - 98.92 / 1040.85;

/**
 * Static Figma screenshot (node 304:7887).
 * Equal left/bottom gutters (100/864). Image is taller than the remaining box so the
 * channel header overflows the top, matching Figma's ~99px crop.
 */
export const OnboardingLoginPreview = (): ReactElement => (
  <div
    className='absolute'
    style={{
      ['--g' as string]: 'calc(100 / 864 * 100cqw)',
      ['--visible-w' as string]: 'calc(100cqw - var(--g))',
      ['--visible-h' as string]: 'calc(100cqh - var(--g))',
      left: 'var(--g)',
      bottom: 'var(--g)',
      top: 'auto',
      right: 'auto',
      overflow: 'hidden',
      height: `max(calc(var(--visible-w) / ${IMG_ASPECT}), calc(var(--visible-h) / ${TOP_VISIBLE}))`,
      width: `max(var(--visible-w), calc(var(--visible-h) / ${TOP_VISIBLE} * ${IMG_ASPECT}))`,
      borderRadius: 'calc(28.71 / 864 * 100cqw)',
      boxShadow:
        '0px calc(176.679 / 864 * 100cqw) calc(49.189 / 864 * 100cqw) 0px rgba(0,0,0,0), 0px calc(113.436 / 864 * 100cqw) calc(45.174 / 864 * 100cqw) 0px rgba(0,0,0,0.01), 0px calc(63.243 / 864 * 100cqw) calc(38.147 / 864 * 100cqw) 0px rgba(0,0,0,0.04), 0px calc(28.108 / 864 * 100cqw) calc(28.108 / 864 * 100cqw) 0px rgba(0,0,0,0.06), 0px calc(7.027 / 864 * 100cqw) calc(15.058 / 864 * 100cqw) 0px rgba(0,0,0,0.07)',
    }}
  >
    <img
      src='/login-preview/channel-preview.png'
      alt=''
      className='pointer-events-none absolute inset-0 size-full max-w-none object-cover object-bottom'
    />
  </div>
);
