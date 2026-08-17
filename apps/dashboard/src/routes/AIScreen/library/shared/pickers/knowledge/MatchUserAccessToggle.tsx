import { type ReactElement } from 'react';
import { Switch } from '@/components/ui/Switch';
import type { KbScope } from './knowledgeCatalog';

export function MatchUserAccessToggle({
  scope,
  onScopeChange,
}: {
  scope: KbScope;
  onScopeChange: (next: KbScope) => void;
}): ReactElement {
  return (
    <div className='flex h-[38px] w-full shrink-0 items-center justify-between gap-4 px-2.5 py-2'>
      <span className='min-w-0 truncate text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
        Match User Access
      </span>
      <Switch
        checked={scope === 'USER'}
        onCheckedChange={next => onScopeChange(next ? 'USER' : 'COLLECTIONS')}
        aria-label='Match user access'
      />
    </div>
  );
}
