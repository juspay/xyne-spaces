import { ReactElement, ReactNode } from 'react';
import { CheckTickSingle } from '@xyne/icons';
import { cn } from '../../../../utils/classNames';

// Wavy squiggle path data lifted from the Figma "Agent Hub" empty-state cards.
// Each squiggle stretches to fill its row (preserveAspectRatio='none'), so the
// path coordinate space is preserved verbatim from Figma.
const CARD1_ROW1_SHORT = [
  'M1.25033 3.5067L2.60088 2.95962C5.69505 1.70623 9.20844 2.06064 11.99 3.90674L12.3669 4.15691C12.7127 4.38646 13.082 4.57864 13.4684 4.73022C14.7405 5.22916 16.1469 5.26821 17.4447 4.84062L17.8347 4.71215C18.2585 4.57251 18.668 4.39268 19.0576 4.17512L21.0791 3.04627C24.0196 1.40425 27.4492 0.864543 30.7519 1.52411C31.892 1.75182 32.9998 2.11914 34.0501 2.61779L35.6072 3.35698C38.4389 4.70137 41.6883 4.86788 44.6427 3.81998',
];
const CARD1_ROW1_LONG = [
  'M1.25012 6.18543L11.0546 7.33558C16.3952 7.96207 21.8073 7.50185 26.9654 5.98259L28.2403 5.6071C33.95 3.92538 39.9957 3.73713 45.7989 5.06036L51.7745 6.42288C56.733 7.55348 61.9367 6.71414 66.2882 4.08188C72.3154 0.436035 79.8346 0.301711 85.9881 3.72995L86.1649 3.82849C89.1352 5.48329 92.4789 6.35208 95.879 6.35251L105.913 6.35377C110.924 6.3544 115.915 5.71225 120.762 4.44306L123.25 3.79172',
];
const CARD1_ROW2 = [
  'M123.318 3.18383L121.917 3.46448C110.336 5.78482 98.3963 5.65185 86.8695 3.07415L79.5015 1.80169C73.7237 0.803866 67.7931 1.16308 62.178 2.85096C57.1231 4.37045 51.806 4.815 46.569 4.15601L30.3191 2.11123',
  'M71.9025 15.8807L73.3014 15.754C75.8017 15.5276 78.3169 15.9761 80.5849 17.0526L81.5401 17.5612C83.3999 18.5513 85.5554 18.8342 87.6076 18.3574C88.421 18.1685 89.2029 17.8637 89.9295 17.4523L91.2207 16.7213C96.4323 13.7707 102.731 13.4519 108.213 15.8612L109.601 16.4709L110.104 16.7153C114.21 18.7084 118.879 19.219 123.318 18.1604',
];
const CARD2_ROW1 = [
  'M1.25007 3.71934L3.63312 3.52838C9.21078 3.08145 14.7769 4.52077 19.4387 7.61549C24.3184 10.9748 30.6958 11.2257 35.8243 8.25993L36.9387 7.61549L38.9495 6.63003C51.9912 0.23861 67.0918 -0.490224 80.6885 4.61549L81.5083 4.95576C90.3931 8.6433 100.182 9.57011 109.601 7.61549',
];
const CARD2_ROW2 = [
  'M1.25026 4.01616L8.84921 2.35801C18.6773 0.213441 28.9302 1.19787 38.1707 5.17331L39.0412 5.54782C41.3762 6.55241 43.8048 7.32401 46.2915 7.85138L53.7371 9.43045C59.2278 10.5949 64.9561 9.47865 69.6078 6.33767C76.1753 1.90315 84.6987 1.60931 91.556 5.58103L95.4364 7.82855C99.6768 10.2846 104.49 11.5784 109.391 11.5793L115.038 11.5803C120.85 11.5813 126.616 10.5458 132.064 8.52234L133.25 8.08183',
];
const CARD2_ROW3 = [
  'M1.25033 7.74925L5.82866 9.16196C11.93 11.0446 18.5338 10.3741 24.1323 7.30353L24.7935 6.94088C30.1353 4.01103 36.4572 3.44236 42.2362 5.37187L52.1188 8.67154C55.8193 9.90709 59.886 8.46804 61.9858 5.17998C63.8374 2.28071 67.2523 0.781355 70.6398 1.38043L89.9901 4.80251C92.9313 5.32266 95.9235 5.49365 98.9048 5.31195L113.516 4.4214',
];

interface SuggestionCardProps {
  title: string;
  subtitle: string;
  prompt: string;
  onSelect: (prompt: string) => void;
  className?: string;
  children: ReactNode;
}

/**
 * A single tilted, clickable suggestion card. Rendered as a real <button> so it
 * is keyboard-focusable; clicking calls onSelect(prompt) to populate the input.
 */
const SuggestionCard = ({
  title,
  subtitle,
  prompt,
  onSelect,
  className,
  children,
}: SuggestionCardProps): ReactElement => {
  return (
    <button
      type='button'
      onClick={() => onSelect(prompt)}
      data-track-category='XyneAI'
      data-track-name='SELECT_SUGGESTION'
      className={cn(
        'flex flex-col items-start gap-[24px] overflow-clip rounded-[20px] border border-border bg-card px-[20px] pb-[20px] pt-[16px] text-left',
        'shadow-[0px_22px_22px_0px_rgba(41,45,56,0.04),0px_6px_12px_0px_rgba(41,45,56,0.05)]',
        'cursor-pointer transition duration-200 ease-out hover:z-10 hover:-translate-y-1 hover:scale-[1.02] hover:shadow-[0px_28px_30px_0px_rgba(41,45,56,0.07),0px_10px_18px_0px_rgba(41,45,56,0.06)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <div className='flex flex-col gap-[4px]'>
        <span className='text-[14px] font-semibold leading-[22px] text-foreground'>{title}</span>
        <span className='text-[12px] font-normal leading-[16px] tracking-[-0.12px] text-muted-foreground'>
          {subtitle}
        </span>
      </div>
      {children}
    </button>
  );
};

/**
 * Theme-aware wavy squiggle. Stretches to fill its wrapper via
 * preserveAspectRatio='none'; the stroke stays a crisp ~2px thanks to
 * vectorEffect='non-scaling-stroke'. Colored via currentColor (text-foreground)
 * at low opacity so it reads faint on both light and dark cards.
 */
const Squiggle = ({
  viewBox,
  paths,
  className,
}: {
  viewBox: string;
  paths: string[];
  className?: string;
}): ReactElement => (
  <svg
    viewBox={viewBox}
    preserveAspectRatio='none'
    fill='none'
    aria-hidden
    className={cn('block h-full w-full text-foreground', className)}
  >
    {paths.map((d, i) => (
      <path
        key={i}
        d={d}
        stroke='currentColor'
        strokeOpacity={0.1}
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
        vectorEffect='non-scaling-stroke'
      />
    ))}
  </svg>
);

/** Decorative avatar placeholder — a muted gradient block, never a real photo. */
const AvatarPlaceholder = (): ReactElement => (
  <div className='size-[24px] shrink-0 rounded-[6px] bg-gradient-to-br from-foreground/[0.12] to-foreground/[0.04]' />
);

/** Subtle 4-point sparkle above the heading. Theme-aware via currentColor. */
const Spark = ({ className }: { className?: string }): ReactElement => (
  <svg viewBox='0 0 64 64' fill='none' aria-hidden className={cn('text-foreground', className)}>
    <path
      d='M31.9996 0C33.8528 0 35.3555 1.5027 35.3555 3.35582V10.8126C35.3555 20.6609 43.3391 28.6445 53.1874 28.6445H60.6442C62.4973 28.6445 64 30.1472 64 32.0004C64 33.8534 62.4973 35.3555 60.6442 35.3555H53.1874C43.3391 35.3555 35.3555 43.3391 35.3555 53.1874V60.6449C35.3554 62.498 33.8527 64 31.9996 64C30.1467 63.9999 28.6446 62.4979 28.6445 60.6449V53.1874C28.6445 43.3391 20.6609 35.3555 10.8126 35.3555H3.35509C1.50213 35.3553 4.91043e-05 33.8533 0 32.0004C8.09984e-08 30.1473 1.5021 28.6447 3.35509 28.6445H10.8126C20.6609 28.6445 28.6445 20.6609 28.6445 10.8126V3.35582C28.6445 1.50279 30.1466 0.000148366 31.9996 0Z'
      fill='currentColor'
      fillOpacity={0.08}
    />
  </svg>
);

interface XyneAIEmptyStateProps {
  // TODO: wire to input populate
  onSelect?: (prompt: string) => void;
  /**
   * Hide the tilted suggestion cards, keeping just the heading. The cards are a
   * fixed 382px composition that only scales down to fit; in a narrow Streams
   * column they dominate a panel meant to sit quietly beside five others.
   */
  hideSuggestions?: boolean;
}

/**
 * Empty-state center illustration for the Xyne AI sidebar. Two overlapping,
 * tilted suggestion cards sitting under a heading. Cards are clickable and will
 * later populate the chat input (onSelect is stubbed for now).
 */
export const XyneAIEmptyState = ({
  onSelect = () => {},
  hideSuggestions = false,
}: XyneAIEmptyStateProps): ReactElement => {
  if (hideSuggestions) {
    return (
      <div className='flex h-full w-full select-none items-center justify-center px-4'>
        <div className='flex flex-col items-center gap-4'>
          <Spark className='size-12' />
          <h2 className='text-center text-[15px] font-semibold leading-[24px] tracking-[-0.3px] text-muted-foreground'>
            What can Xyne help you with?
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full w-full select-none items-center justify-center px-4'>
      <div className='flex w-full flex-col items-center gap-[24px]'>
        <Spark className='mb-2 size-16' />
        <h2 className='text-center text-[16px] font-semibold leading-[28px] tracking-[-0.32px] text-muted-foreground'>
          What can Xyne help you with?
        </h2>

        {/* Fixed-composition illustration: scale it down uniformly to fit narrow
            sidebars (mobile / dragged-in panel) instead of clipping. Caps at 1x
            once ~398px of width is available. */}
        <div className='w-full' style={{ containerType: 'inline-size' }}>
          {/* `isolate` keeps the cards' `hover:z-10` inside this group. It only
              exists to lift a hovered card above its overlapping sibling —
              without a stacking context here it also outranks the composer, and
              a hovered card paints over the context picker floating above it. */}
          <div
            className='relative isolate mx-auto h-[188px] w-[382px] origin-top'
            style={{ transform: 'scale(min(1, 100cqw / 398))' }}
          >
            {/* Card 1 — "Catch me up" */}
            <SuggestionCard
              title='Catch me up'
              subtitle='12 new since 9:00am'
              prompt='Catch me up'
              onSelect={onSelect}
              className='absolute left-[0.55px] top-0 w-[200px] rotate-[-2.78deg]'
            >
              <div className='flex w-full flex-col gap-[16px]'>
                {/* Row 1 */}
                <div className='flex items-center gap-[14px]'>
                  <AvatarPlaceholder />
                  <div className='flex flex-1 flex-col gap-[3px]'>
                    <div className='h-[5px] w-[43px]'>
                      <Squiggle viewBox='0 0 45.893 6.38513' paths={CARD1_ROW1_SHORT} />
                    </div>
                    <div className='h-[10px] w-full'>
                      <Squiggle viewBox='0 0 124.5 8.85713' paths={CARD1_ROW1_LONG} />
                    </div>
                  </div>
                </div>
                {/* Row 2 */}
                <div className='flex items-center gap-[14px]'>
                  <AvatarPlaceholder />
                  <div className='h-[19.75px] w-[123px] rotate-180'>
                    <Squiggle viewBox='0 0 124.568 19.9494' paths={CARD1_ROW2} />
                  </div>
                </div>
              </div>
            </SuggestionCard>

            {/* Card 2 — "Find action items" */}
            <SuggestionCard
              title='Find action items'
              subtitle="From today's messages"
              prompt='Find action items'
              onSelect={onSelect}
              className='absolute left-[168.37px] top-[9.5px] w-[200px] rotate-[3.67deg]'
            >
              <div className='flex w-full flex-col gap-[8px]'>
                {/* Row 1 — checked */}
                <div className='flex items-center gap-[12px]'>
                  <div className='flex size-[16px] shrink-0 items-center justify-center rounded-[5px] bg-foreground/10 text-foreground'>
                    <CheckTickSingle size={13} />
                  </div>
                  <div className='h-[11.5px] w-[108px]'>
                    <Squiggle viewBox='0 0 110.852 11.5715' paths={CARD2_ROW1} />
                  </div>
                </div>
                {/* Row 2 — unchecked */}
                <div className='flex items-center gap-[12px]'>
                  <div className='size-[16px] shrink-0 rounded-[5px] border-[1.5px] border-border' />
                  <div className='h-[12.5px] flex-1'>
                    <Squiggle viewBox='0 0 134.501 12.8303' paths={CARD2_ROW2} />
                  </div>
                </div>
                {/* Row 3 — unchecked */}
                <div className='flex items-center gap-[12px]'>
                  <div className='size-[16px] shrink-0 rounded-[5px] border-[1.5px] border-border' />
                  <div className='h-[11.7px] w-[112px] -scale-y-100'>
                    <Squiggle viewBox='0 0 114.766 11.4609' paths={CARD2_ROW3} />
                  </div>
                </div>
              </div>
            </SuggestionCard>
          </div>
        </div>
      </div>
    </div>
  );
};

export default XyneAIEmptyState;
