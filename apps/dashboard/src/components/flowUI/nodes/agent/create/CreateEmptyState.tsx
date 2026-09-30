import type { ReactElement } from 'react';

/**
 * Default state of the create-agent Build chat (no messages yet).
 * Figma "Claw Agents" 1956:34153 (light) / 1956:34154 (dark). The spark is the exact
 * Figma export for each theme (1956:34147 light, 1956:34156 dark). Midnight is the only
 * dark theme and does not set the `dark` class, so the two are switched on `data-theme`.
 * One component serves every overlay version.
 */
export function CreateEmptyState(): ReactElement {
  return (
    <div
      className='flex h-full min-h-[12rem] animate-fadeUp flex-col items-center justify-center gap-7 px-6'
      data-testid='agent-create-empty-state'
    >
      <img
        src='/svgs/create-agent-spark-light.svg'
        alt=''
        width={64}
        height={64}
        draggable={false}
        className='size-16 shrink-0 [[data-theme=midnight]_&]:hidden'
      />
      <img
        src='/svgs/create-agent-spark-dark.svg'
        alt=''
        width={64}
        height={64}
        draggable={false}
        className='hidden size-16 shrink-0 [[data-theme=midnight]_&]:block'
      />
      <h1 className="text-center font-['Google_Sans_Flex',Inter,sans-serif] text-[36px] font-medium leading-[1.2] tracking-[-0.72px] text-foreground [font-variation-settings:'GRAD'_0,'ROND'_0,'wdth'_100]">
        Let&apos;s build your agent
      </h1>
    </div>
  );
}
