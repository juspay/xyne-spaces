import { type ReactElement, type ReactNode } from 'react';

const LABEL = 'text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground';

export function SubagentSectionLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}): ReactElement {
  return htmlFor === undefined ? (
    <span className={LABEL}>{children}</span>
  ) : (
    <label htmlFor={htmlFor} className={LABEL}>
      {children}
    </label>
  );
}
