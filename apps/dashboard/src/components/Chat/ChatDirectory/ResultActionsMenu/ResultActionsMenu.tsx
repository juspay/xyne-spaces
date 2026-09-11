/**
 * ⌥↵ Actions menu for a highlighted Cmd+K user/channel result (Message / Call).
 *
 * Built on Radix DropdownMenu so it gets real popup semantics for free:
 *  - it PORTALS out of the palette's DOM subtree, so the palette's capture-phase keydown handler
 *    never intercepts the menu's arrows/Enter, and roving focus gives arrow-key navigation plus
 *    Enter/Space to select with no manual key handling;
 *  - click-outside dismisses via Radix. Escape is handled explicitly on `window` (see below): the
 *    menu renders as a SIBLING of the Cmd+K dialog, so it isn't in the dialog's dismissable-layer
 *    stack, and the window-capture listener is what keeps Escape from closing the palette.
 *
 * Actions come from the registry and dispatch via `onRun` (wired to
 * `useSlashCommands.invokeActionOnTarget`). Colours are semantic tokens (popover/border/accent/
 * muted), so the menu tracks the active theme — restyle it by tweaking those CSS variables.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '../../../../utils/classNames';
import type { CommandTarget } from '../SlashCommands/QuickDmComposer';
import { RESULT_ACTIONS, type ResultActionKind } from './actionsRegistry';

interface ResultActionsMenuProps {
  open: boolean;
  target: CommandTarget | null;
  onRun: (kind: ResultActionKind) => void;
  onClose: () => void;
  /** The selected result row the menu opens above. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export const ResultActionsMenu: React.FC<ResultActionsMenuProps> = ({
  open,
  target,
  onRun,
  onClose,
  anchorRef,
}) => {
  const [anchorRect, setAnchorRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  // A select already ran the action; only a real dismiss (Esc / click-outside) should refocus search.
  const justSelectedRef = useRef(false);
  // Latest onClose, read by the window-level Escape handler below.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // First action row — focused on open so it's pre-highlighted (Enter fires it immediately).
  const firstItemRef = useRef<HTMLDivElement>(null);

  // Mirror the selected row's rect onto the virtual anchor so the menu opens right above that row.
  // Measured before paint to avoid a first-frame jump.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef?.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setAnchorRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    } else {
      setAnchorRect({
        left: window.innerWidth - 12,
        top: window.innerHeight - 12,
        width: 0,
        height: 0,
      });
    }
  }, [open, anchorRef]);

  // Escape must dismiss ONLY this menu, never the Cmd+K dialog underneath. Radix arms its Escape
  // listener on `document` in the capture phase and the dialog registered first, so we can't win
  // that race there. Listen on `window` in capture instead — window is the outermost target in the
  // capture phase, so this fires before any document-level listener; stopping the event means Radix
  // (the dialog OR this menu) never sees the Escape, and we close the menu ourselves.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // Radix focuses the menu content on open but doesn't reliably pre-highlight the first item when
  // opened programmatically. Focus it ourselves on the next frame (after Radix's own open-focus) so
  // the first action (Message) is highlighted and Enter fires it — matching the palette's
  // auto-selected first row.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame((): void => {
      firstItemRef.current?.focus();
    });
    return (): void => {
      cancelAnimationFrame(raf);
    };
  }, [open]);

  if (!target) return null;

  const actions = RESULT_ACTIONS;

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={isOpen => {
        if (isOpen) return;
        if (justSelectedRef.current) {
          justSelectedRef.current = false;
          return;
        }
        onClose();
      }}
    >
      {/* Virtual anchor: a fixed overlay matching the selected row's rect. pointer-events:none so a
          click on the row still reaches Radix as an outside-click (closing the menu). */}
      <DropdownMenu.Trigger asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
            pointerEvents: 'none',
          }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side='top'
          align='start'
          alignOffset={8}
          sideOffset={6}
          onCloseAutoFocus={e => e.preventDefault()}
          className={cn(
            // Surface uses ui/Select's popover tokens (rounded-md, border) but a stronger shadow so
            // this floating menu reads as an elevated layer over the palette instead of bleeding into
            // it. Narrow width since there's no header. Stays a DropdownMenu for menu semantics.
            'z-[10051] w-52 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-2xl outline-none',
            // Same open/close fade+zoom and side-slide as SelectContent.
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:slide-in-from-top-2',
          )}
        >
          {/* No header: the popup is anchored directly above the highlighted row, so repeating the
              target name would be redundant. The two actions carry their own icons + labels. */}
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <DropdownMenu.Item
                key={action.id}
                ref={index === 0 ? firstItemRef : undefined}
                data-track-category='CMDK_ACTIONS'
                data-track-name={`cmdk_action_${action.id}`}
                onSelect={() => {
                  justSelectedRef.current = true;
                  onRun(action.kind);
                }}
                className={cn(
                  // Row shape mirrors ui/Select's SelectItem (minus the value checkmark / pr-8).
                  'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none',
                  'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
                )}
              >
                <Icon className='h-4 w-4 shrink-0' />
                <span className='flex-1'>{action.label}</span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
