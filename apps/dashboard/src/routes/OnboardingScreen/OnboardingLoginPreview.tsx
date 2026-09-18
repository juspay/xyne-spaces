import type { ReactElement } from 'react';

/**
 * Figma 314:9594 “Login Illustration 1” on red panel 264:21707 (artboard 264:21698).
 *
 * Layer size is FIXED 1086×1084 CSS px — the PNG is not a `width: 100%` photo.
 * Constraints are CENTER/CENTER, which CSS expresses as panel-center + a fixed offset:
 *
 *   offsetX = (100 + 1086 / 2) - 864 / 2 = 211
 *   offsetY = (-174 + 1084 / 2) - 1010 / 2 = -137
 *
 * so `left: calc(50% + 211px); top: calc(50% - 137px); transform: translate(-50%, -50%)`.
 * Panel overflow clips the rest. Honeycomb is a separate non-scaling layer.
 */
const ILLUSTRATION_W = 1086;
const ILLUSTRATION_H = 1084;
const CENTER_OFFSET_X = 211;
const CENTER_OFFSET_Y = -137;

export const OnboardingLoginPreview = (): ReactElement => (
  <div
    className='absolute'
    data-onboarding-channel-card=''
    style={{
      left: `calc(50% + ${CENTER_OFFSET_X}px)`,
      top: `calc(50% + ${CENTER_OFFSET_Y}px)`,
      width: ILLUSTRATION_W,
      height: ILLUSTRATION_H,
      transform: 'translate(-50%, -50%)',
      boxShadow:
        '0px 176.679px 49.189px 0px rgba(0,0,0,0), 0px 113.436px 45.174px 0px rgba(0,0,0,0.01), 0px 63.243px 38.147px 0px rgba(0,0,0,0.04), 0px 28.108px 28.108px 0px rgba(0,0,0,0.06), 0px 7.027px 15.058px 0px rgba(0,0,0,0.07)',
    }}
  >
    <img
      src='/login-preview/channel-preview.png'
      alt=''
      width={ILLUSTRATION_W}
      height={ILLUSTRATION_H}
      draggable={false}
      className='pointer-events-none block max-w-none'
      data-onboarding-channel-img=''
      style={{
        width: ILLUSTRATION_W,
        height: ILLUSTRATION_H,
        maxWidth: 'none',
      }}
    />
  </div>
);
