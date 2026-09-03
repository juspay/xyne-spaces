import { type ReactElement } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';

const SECTION_SHAPES: { label: string; lines: string[] }[] = [
  { label: 'w-[104px]', lines: ['w-full', 'w-[92%]', 'w-[64%]'] },
  { label: 'w-[62px]', lines: ['w-full', 'w-[78%]'] },
  { label: 'w-[116px]', lines: ['w-full', 'w-[88%]', 'w-[54%]'] },
  { label: 'w-[98px]', lines: ['w-[86%]', 'w-[46%]'] },
  { label: 'w-[110px]', lines: ['w-[70%]', 'w-[58%]'] },
];

export function BriefSkeleton(): ReactElement {
  return (
    <div className='flex w-full flex-col gap-9' aria-hidden>
      <Skeleton className='mx-auto my-10 h-[44px] w-[260px] rounded-lg' />
      {SECTION_SHAPES.map((section, index) => (
        <section key={index} className='flex w-full items-start gap-4'>
          <div className='flex w-[145px] shrink-0 items-center p-1.5'>
            <Skeleton className={`h-[18px] ${section.label}`} />
          </div>
          <div className='flex min-w-0 flex-1 flex-col gap-3 p-1.5'>
            {section.lines.map((width, lineIndex) => (
              <div key={lineIndex} className='flex w-full items-start gap-3'>
                <span className='flex size-[22px] shrink-0 items-center justify-center'>
                  <Skeleton className='size-1.5 rounded-full' />
                </span>
                <Skeleton className={`h-[18px] ${width}`} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
