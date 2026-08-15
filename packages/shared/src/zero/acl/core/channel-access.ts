import { ChannelVisibility } from '../../schema';
import type { Context } from '../../schema';
import type { SelectArgs } from './types';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function channelAccessWhere(ctx: Context): (helpers: any) => any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ({ or, cmp, exists }: any) =>
    or(
      cmp('visibility', '=', ChannelVisibility.PUBLIC),
      exists('participants', (p: any) => p.where('userId', ctx.userID)),
    );
}

export function scalarChannelBody(
  ctx: Context,
  channelId: string,
  isMember: boolean | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (ch: any) => any {
  if (isMember === true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ch: any) =>
      ch
        .where('id', channelId)
        .where('workspaceId', '=', ctx.workspaceId)
        .whereExists(
          'participants',
          (p: any) => p.where('userId', ctx.userID).where('channelId', channelId),
          SCALAR,
        );
  }
  if (isMember === false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ch: any) =>
      ch
        .where('id', channelId)
        .where('workspaceId', '=', ctx.workspaceId)
        .where('visibility', ChannelVisibility.PUBLIC);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ch: any) =>
    ch
      .where('id', channelId)
      .where('workspaceId', '=', ctx.workspaceId)
      .where(channelAccessWhere(ctx));
}
