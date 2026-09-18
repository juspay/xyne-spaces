import type { ReactElement, ReactNode } from 'react';
import { OnboardingLoginPreview } from './OnboardingLoginPreview';

/** Figma 264:25096 — OAuth pill with 82px left inset so icon+label sit optically centered. */
export const onboardingOauthButtonClassName =
  'flex h-14 w-full cursor-pointer items-center gap-3 rounded-full bg-[rgba(35,34,41,0.04)] pl-[82px] pr-4 text-[15px] font-[450] leading-[1.5] tracking-[-0.1px] text-[#232229] transition-colors hover:bg-[rgba(35,34,41,0.07)] disabled:opacity-50';

export const onboardingEmailInputClassName =
  'h-14 w-full rounded-full border border-[rgba(35,34,41,0.1)] bg-white px-4 text-[15px] font-[450] leading-[1.5] tracking-[-0.1px] text-[#232229] placeholder:text-[rgba(35,34,41,0.4)] focus:border-[rgba(35,34,41,0.28)] focus:outline-none';

export const onboardingContinueButtonClassName =
  'h-14 w-full cursor-pointer rounded-full bg-[#232229] text-[15px] font-[550] leading-[1.5] tracking-[-0.1px] text-white transition-colors hover:bg-[#2e2d34] disabled:opacity-50';

/**
 * Right half of Figma 264:21707: solid #ff4242 only.
 * Honeycomb 264:21708 is a non-stretching CSS background (native 1926.9×1165.04 px
 * pinned at Figma x=-153, y=-78 — group children are MIN/MIN, never scaled).
 * Channel illustration is a separate CENTER/CENTER layer in OnboardingLoginPreview.
 */
export const OnboardingLoginLayout = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='flex h-[100dvh] w-full overflow-hidden bg-white'>
    <section className='flex h-full w-full flex-col items-center justify-center overflow-y-auto px-6 py-10 md:w-1/2'>
      {children}
    </section>
    <section
      className='relative hidden h-full w-1/2 overflow-hidden bg-[#ff4242] md:block'
      data-onboarding-red-panel=''
      style={{
        containerType: 'inline-size',
        backgroundImage: 'url(/login-preview/honeycomb.svg)',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1926.9px 1165.04px',
        backgroundPosition: '-153px -78px',
      }}
    >
      <OnboardingLoginPreview />
    </section>
  </div>
);

export const OnboardingSpacesMark = (): ReactElement => (
  <div className='relative h-11 w-[268px]' aria-label='Xyne Spaces'>
    <img
      src='/svgs/xyne.svg'
      alt=''
      className='absolute left-0 top-[11px] h-[25px] w-[130px] object-contain object-left'
    />
    <span
      className='absolute left-[134px] top-0 text-[36.67px] font-[410] leading-[1.2] tracking-[-1.47px] text-[rgba(35,34,41,0.4)]'
      style={{ fontStretch: 'expanded', fontVariationSettings: '"wdth" 132' }}
    >
      spaces
    </span>
  </div>
);
