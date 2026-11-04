import { ChannelRole, type Context } from "../../schema";

// Kept as one expression builder so result rows cannot drift from one visibility
// interpretation to another across scalar/channel/guest query paths.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pollResultAccessWhere =
  (ctx: Context) =>
  ({ or, and, cmp, exists }: any) =>
    or(
      cmp("createdBy", "=", ctx.userID),
      cmp("resultVisibility", "=", "EVERYONE"),
      and(
        cmp("resultVisibility", "=", "AFTER_CLOSE"),
        cmp("closedAt", "IS NOT", null),
      ),
      and(
        cmp("resultVisibility", "=", "ADMIN_ONLY"),
        exists("message", (message: any) =>
          message.whereExists("conversation", (conversation: any) =>
            conversation.whereExists("channel", (channel: any) =>
              channel.where(
                ({
                  or: channelOr,
                  cmp: channelCmp,
                  exists: channelExists,
                }: any) =>
                  channelOr(
                    channelCmp("createdBy", "=", ctx.userID),
                    channelExists("participants", (participant: any) =>
                      participant
                        .where("userId", "=", ctx.userID)
                        .where("role", "=", ChannelRole.ADMIN),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),
    );
