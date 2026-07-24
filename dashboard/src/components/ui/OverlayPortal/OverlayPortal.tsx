import { ReactNode, ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { useOverlayZIndex } from '../../../contexts/OverlayZIndexContext';

export interface OverlayPortalProps {
  children: ReactNode;
  /**
   * Extra classes for the full-screen root — layout and background only, e.g.
   * `flex items-center justify-center bg-black/40`. Positioning (`fixed
   * inset-0`), z-index and `pointer-events` are owned by the primitive.
   */
  className?: string;
  /**
   * The overlay's own close handler. Wire it so Escape dismisses just this
   * overlay. A modal Radix host (Cmd+K) still needs a matching `onEscapeKeyDown`
   * guard to stay open — its Escape listener runs at document-capture, before
   * this one — but this is what actually closes the overlay.
   */
  onEscape?: () => void;
}

/**
 * Full-screen root for non-Radix modals (custom `createPortal` dialogs) so they
 * behave correctly when opened from inside a transformed, high-z, *modal* host
 * like the Cmd+K dialog. It fixes the four ways such a modal otherwise breaks:
 *
 *  - **Transform-trap** — portals to `<body>` so `position: fixed` is measured
 *    against the viewport, not a `transform`ed ancestor (the Cmd+K dialog uses
 *    `-translate-x-1/2`, which would otherwise become the containing block and
 *    push the overlay off-centre).
 *  - **Stacking** — applies the composer overlay z-index from context so the
 *    modal paints above the host (`z-[9999]`) instead of behind it.
 *  - **Interactivity** — a modal Radix host sets `pointer-events: none` on all
 *    non-layer `<body>` content, which makes a raw portal click-through;
 *    `pointer-events-auto` restores clicks on the modal itself.
 *  - **Focus** — a modal Radix host traps focus inside its own content, so an
 *    input in a body-portaled modal can't hold focus (typing is swallowed). The
 *    `FocusScope` here establishes a nested trap that *pauses* the host's trap
 *    while the overlay is mounted, mirroring how nested Radix dialogs coexist.
 *
 * The `data-overlay-portal` marker lets a Radix modal host keep itself open
 * when an interaction originates here (see `ChannelCommandMenu`'s
 * `onInteractOutside` guard) — without it Radix reads the click as "outside"
 * its content and dismisses the whole dialog.
 */
export const OverlayPortal = ({
  children,
  className = '',
  onEscape,
}: OverlayPortalProps): ReactPortal => {
  const zIndex = useOverlayZIndex() ?? 'z-50';
  return createPortal(
    <FocusScope asChild loop trapped>
      <div
        data-overlay-portal=''
        role='presentation'
        className={`fixed inset-0 pointer-events-auto ${zIndex} ${className}`}
        onKeyDown={event => {
          // Focus is trapped inside here, so Escape reaches this bubble handler.
          // Close just this overlay; the host palette is kept open by its own
          // document-capture `onEscapeKeyDown` guard, which already ran.
          if (event.key === 'Escape' && onEscape) {
            event.stopPropagation();
            onEscape();
          }
        }}
      >
        {children}
      </div>
    </FocusScope>,
    document.body,
  );
};

OverlayPortal.displayName = 'OverlayPortal';
