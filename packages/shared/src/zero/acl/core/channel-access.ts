import { ChannelVisibility } from '../../schema';
import type { Context } from '../../schema';
import type { SelectArgs } from './types';

/**
 * Uniform channel-access checks for channel-scoped ACLs.
 *
 * Every ACL that gates rows on "the channel is PUBLIC or the caller
 * participates in it" should build that check through these helpers so the
 * shapes (and their scalar fast paths) stay identical everywhere.
 *
 * Fast paths: when the query is scoped to a single channel — args.channelId,
 * which by convention matches the query's own channel filter — the access
 * decision is row-invariant, so the exists chain is marked `scalar` and zero
 * resolves it ONCE per hydration instead of probing channels/participants per
 * row (see zqlite resolve-scalar-subqueries: a scalar resolves when a unique
 * key of its table is literal-pinned; resolution runs inside-out, so an outer
 * scalar resolves after its inner scalar collapses to a literal). A
 * non-resolvable scalar silently falls back to the per-row EXISTS.
 *
 * `args.isMember` is only a hint to pick a skinnier verified shape — access
 * is always verified against ctx.userID, never trusted from the client.
 */

export const SCALAR = { scalar: true } as const;

export function channelAccessArgs(args?: SelectArgs): {
  channelId: string | undefined;
  isMember: boolean | undefined;
} {
  return {
    channelId: args?.channelId as string | undefined,
    isMember: args?.isMember as boolean | undefined,
  };
}

/**
 * Per-row fallback: OR(channel is PUBLIC, caller participates). Use inside a
 * channel subquery when no channel scoping is available from args.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function channelAccessWhere(ctx: Context): (helpers: any) => any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ({ or, cmp, exists }: any) =>
    or(
      cmp('visibility', '=', ChannelVisibility.PUBLIC),
      exists('participants', (p: any) => p.where('userId', ctx.userID)),
    );
}

/**
 * Builds the channel-subquery body for the scalar fast paths. Apply as:
 *   query.whereExists('channel', scalarChannelBody(ctx, channelId, isMember), SCALAR)
 *
 *  - isMember === true:  membership pre-checked upstream; verify with a scalar
 *    participants probe only (skips the visibility branch).
 *  - isMember === false: caller is not a member; channel must be PUBLIC.
 *  - isMember undefined: full OR(public, participant), still resolved once.
 */
export function scalarChannelBody(
  ctx: Context,
  channelId: string,
  isMember: boolean | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (ch: any) => any {
  if (isMember === true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ch: any) =>
      ch.whereExists(
        'participants',
        (p: any) => p.where('userId', ctx.userID).where('channelId', channelId),
        SCALAR,
      );
  }
  if (isMember === false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ch: any) => ch.where('id', channelId).where('visibility', ChannelVisibility.PUBLIC);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ch: any) =>
    ch
      .where('id', channelId)
      .where('workspaceId', '=', ctx.workspaceId)
      .where(channelAccessWhere(ctx));
}
