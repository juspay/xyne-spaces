import { createContext, useContext } from 'react';

/**
 * Optional Tailwind z-index class for portaled overlays spawned by a composer —
 * the `@`/`#`/emoji selector popovers, the attachment menu, and the
 * canvas/transcript modals. `undefined` (the default) means "leave each overlay
 * at its own z-index". Wrap an `InputBox` in this provider with a raised class
 * (e.g. `z-[10000]`) to lift those overlays above a high-z surface such as the
 * Cmd+K dialog (`z-[9999]`). Context flows through Radix portals because
 * `createPortal` keeps the React tree intact — no prop threading needed for the
 * selector popovers.
 */
export const OverlayZIndexContext = createContext<string | undefined>(undefined);

export const useOverlayZIndex = (): string | undefined => useContext(OverlayZIndexContext);
