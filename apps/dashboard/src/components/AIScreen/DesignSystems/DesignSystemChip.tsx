import { useState, type ReactElement } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '../../../utils/classNames';
import { MENU_ROW, MENU_SEPARATOR, MENU_SURFACE } from '../../Composer/ComposerControls';
import { useConversationDesignSystem, useDesignSystems } from '../../../hooks/useDesignSystems';
import type { DesignSystemRecord } from '../../../services/XyneAI/XyneAIDesignSystemsService';

export interface DesignSystemChipProps {
  conversationId: string | undefined;
  side?: 'top' | 'bottom';
  returnFocus: () => void;
}

export function DesignSystemChip({
  conversationId,
  side = 'top',
  returnFocus,
}: DesignSystemChipProps): ReactElement {
  const { systems } = useDesignSystems();
  const { pinned, pin, unpin } = useConversationDesignSystem(conversationId);
  const [busy, setBusy] = useState(false);

  const disabled = !conversationId || busy;
  const label = pinned ? pinned.name : 'Agent default';

  const run = (action: () => Promise<void>, failure: string): void => {
    setBusy(true);
    void (async () => {
      try {
        await action();
      } catch {
        toast.error(failure);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Menu.Root>
      <Menu.Trigger asChild disabled={disabled}>
        <button
          type='button'
          title={
            conversationId
              ? pinned
                ? `This chat uses ${pinned.name}`
                : 'This chat uses the agent default design system'
              : 'Send a message first — a design system is pinned to a chat'
          }
          className={cn(
            'inline-flex h-8 min-w-0 shrink items-center gap-1.5 rounded-full px-3 text-sm transition-colors',
            'hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60',
            'data-[state=open]:bg-secondary data-[state=open]:text-foreground',
            pinned ? 'bg-secondary/60 text-foreground' : 'text-muted-foreground',
          )}
          data-track-category='XyneAI'
          data-track-name='OPEN_DESIGN_SYSTEM_SELECTOR'
          data-testid='composer-design-system'
        >
          <span aria-hidden>🎨</span>
          <span className='max-w-[140px] truncate'>{label}</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side={side}
          align='start'
          sideOffset={8}
          collisionPadding={12}
          className={cn(MENU_SURFACE, 'w-[248px]')}
          onCloseAutoFocus={event => {
            event.preventDefault();
            returnFocus();
          }}
        >
          <div className='px-2.5 pb-2.5 pt-2 text-sm leading-snug text-foreground'>
            {pinned
              ? 'This chat overrides the agent default.'
              : 'This chat follows the agent default.'}
          </div>
          <Menu.Separator className={MENU_SEPARATOR} />
          <Menu.Item
            onSelect={() => run(unpin, 'Could not revert to the agent default')}
            className={MENU_ROW}
            data-track-category='XyneAI'
            data-track-name='UNPIN_DESIGN_SYSTEM'
          >
            <span className='flex-1 truncate'>Agent default</span>
            {!pinned && <Check className='size-4 shrink-0' aria-hidden />}
          </Menu.Item>
          {systems.length > 0 && <Menu.Separator className={MENU_SEPARATOR} />}
          {systems.map((system: DesignSystemRecord) => (
            <Menu.Item
              key={system.id}
              onSelect={() => run(() => pin(system), `Could not pin ${system.name}`)}
              className={MENU_ROW}
              data-track-category='XyneAI'
              data-track-name='PIN_DESIGN_SYSTEM'
              data-track-metadata={JSON.stringify({ designSystemId: system.id })}
            >
              <span className='flex-1 truncate'>{system.name}</span>
              {pinned?.id === system.id && <Check className='size-4 shrink-0' aria-hidden />}
            </Menu.Item>
          ))}
          {systems.length === 0 && (
            <div className='px-2.5 py-2 text-[13px] text-muted-foreground'>
              No design systems yet.
            </div>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
