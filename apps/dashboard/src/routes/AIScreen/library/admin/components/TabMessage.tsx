import type { ReactElement, ReactNode } from 'react';

export function TabMessage({ children }: { children: ReactNode }): ReactElement {
  return <p className='py-8 text-center text-sm text-muted-foreground'>{children}</p>;
}
