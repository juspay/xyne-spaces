/**
 * Slack user -> claw user resolution with email auto-link: an unlinked Slack
 * user is matched by their Slack-verified email against claw users WITHIN the
 * workspace's org, and the UserSurfaceIdentity row is created on first
 * contact. Unresolvable users never execute runs.
 */
import { prisma } from "../../db.js";
import { isSlackApiError, slackClient } from "./api.js";

interface SlackUsersInfoResponse {
  ok?: boolean;
  error?: string;
  user?: { profile?: { email?: string } };
}

export async function resolveSlackUserByEmail(input: {
  currentUserId: string | null;
  surfaceId: string;
  orgId: string;
  teamId: string;
  slackUserId: string;
  botToken: string;
}): Promise<string | null> {
  if (input.currentUserId) return input.currentUserId;

  let body: SlackUsersInfoResponse;
  try {
    body = (await slackClient(input.botToken).users.info({
      user: input.slackUserId,
    })) as SlackUsersInfoResponse;
  } catch (error) {
    if (isSlackApiError(error)) return null;
    throw error;
  }
  const email = body?.user?.profile?.email?.trim();
  if (!email) return null;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, orgId: input.orgId },
    select: { id: true },
  });
  if (!user) return null;

  try {
    await prisma.userSurfaceIdentity.create({
      data: {
        surfaceId: input.surfaceId,
        surfaceWorkspaceId: input.teamId,
        surfaceUserId: input.slackUserId,
        userId: user.id,
        orgId: input.orgId,
        status: "ACTIVE",
        linkedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  } catch (error) {
    // A retry/race may have inserted the same unique identity. Only accept the
    // winning row when it resolves to this exact tenant user.
    const existing = await prisma.userSurfaceIdentity
      .findUnique({
        where: {
          surfaceId_surfaceWorkspaceId_surfaceUserId: {
            surfaceId: input.surfaceId,
            surfaceWorkspaceId: input.teamId,
            surfaceUserId: input.slackUserId,
          },
        },
        select: { userId: true, orgId: true, status: true },
      })
      .catch(() => null);
    if (
      !existing ||
      existing.userId !== user.id ||
      existing.orgId !== input.orgId ||
      existing.status !== "ACTIVE"
    ) {
      throw error;
    }
  }
  return user.id;
}
