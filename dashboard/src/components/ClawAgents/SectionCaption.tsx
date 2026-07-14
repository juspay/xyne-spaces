import { ReactElement, ReactNode } from 'react';

/**
 * Small uppercase caption with an optional "· technical name" suffix, used to
 * head wizard steps and toolbox sections. Ported from the reference wizard so
 * both surfaces read with the same friendly-name · technical-name pattern.
 */
export function SectionCaption({
  friendly,
  technical,
}: {
  friendly: ReactNode;
  technical?: string;
}): ReactElement {
  return (
    <div className='mb-2 inline-flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground'>
      {friendly}
      {technical && (
        <>
          <span className='normal-case text-muted-foreground'>·</span>
          <span className='font-normal normal-case'>{technical}</span>
        </>
      )}
    </div>
  );
}
