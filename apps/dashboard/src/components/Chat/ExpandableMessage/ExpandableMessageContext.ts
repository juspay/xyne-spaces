import { createContext, useContext } from 'react';

/**
 * True when rendering inside an `ExpandableMessage`. The message already owns a
 * "Show more / Show less" control, so nested collapsible blocks (long code
 * blocks) must not render a second, identical toggle.
 *
 * Kept in its own module so `RenderMessageWithHTML` / `markdownComponents` can
 * read it without importing `ExpandableMessage` (which imports them).
 */
export const ExpandableMessageContext = createContext<boolean>(false);

export const useIsInsideExpandableMessage = (): boolean => useContext(ExpandableMessageContext);
