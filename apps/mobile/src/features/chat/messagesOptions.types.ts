import type { UseMessagesOptions } from '@xyne/shared/messages';

/**
 * `useMessages` options the mobile chat screens pass that the pinned
 * `@xyne/shared` revision does not declare yet. The pinned `useMessages` ignores
 * unknown keys, and both are cache-shaping hints only (they never change what
 * is fetched), so this widening is runtime-safe.
 *
 * Drop this once public-source.json moves to a shared revision whose
 * `UseMessagesOptions` includes them.
 */
export type MobileMessagesOptions = UseMessagesOptions & {
  notificationTargetMessageId?: string | null | undefined;
  promoteLatestTailOnColdOpen?: boolean | undefined;
};

/** Identity helper: validates the literal against the wide type, hands shared the narrow one. */
export const toSharedMessagesOptions = (options: MobileMessagesOptions): UseMessagesOptions =>
  options;
