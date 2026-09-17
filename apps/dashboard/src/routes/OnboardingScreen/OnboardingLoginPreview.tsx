import type { ReactElement } from 'react';

/** Figma Onboarding right panel 264:21707 */
const PANEL_W = 864;
const PANEL_H = 1010;

/** Figma 308:8412 — channel screenshot placed on the red panel. */
const FRAME_X = 99.998;
const FRAME_Y = -98.924;
const FRAME_W = 891.43;
const FRAME_H = 1040.849;
const FRAME_RADIUS = 28.71;

/**
 * Static Figma screenshot (node 308:8412).
 * Position maps the frame onto the red panel (864×1010) so left/bottom gutters
 * and the top/right crop match Figma — including the clipped ticket tag
 * (`iOS · Check`).
 */
export const OnboardingLoginPreview = (): ReactElement => (
  <div
    className='absolute overflow-hidden'
    style={{
      left: `calc(${FRAME_X} / ${PANEL_W} * 100cqw)`,
      top: `calc(${FRAME_Y} / ${PANEL_H} * 100cqh)`,
      width: `calc(${FRAME_W} / ${PANEL_W} * 100cqw)`,
      height: `calc(${FRAME_H} / ${PANEL_H} * 100cqh)`,
      borderRadius: `calc(${FRAME_RADIUS} / ${PANEL_W} * 100cqw)`,
      boxShadow:
        '0px calc(176.679 / 864 * 100cqw) calc(49.189 / 864 * 100cqw) 0px rgba(0,0,0,0), 0px calc(113.436 / 864 * 100cqw) calc(45.174 / 864 * 100cqw) 0px rgba(0,0,0,0.01), 0px calc(63.243 / 864 * 100cqw) calc(38.147 / 864 * 100cqw) 0px rgba(0,0,0,0.04), 0px calc(28.108 / 864 * 100cqw) calc(28.108 / 864 * 100cqw) 0px rgba(0,0,0,0.06), 0px calc(7.027 / 864 * 100cqw) calc(15.058 / 864 * 100cqw) 0px rgba(0,0,0,0.07)',
    }}
  >
    <img
      src='/login-preview/channel-preview.png'
      alt=''
      className='pointer-events-none absolute inset-0 size-full max-w-none'
    />
  </div>
);
