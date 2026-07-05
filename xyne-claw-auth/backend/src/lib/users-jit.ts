/**
 * Just-in-time user mirroring.
 *
 * claw-auth's `users` table is a read-only mirror of Spaces' `public.users`,
 * keyed on the same id. Historically the mirror was populated only when the
 * frontend POSTed `/users` after a successful Google login. That meant any
 * other entry point (webhook, scheduled job, MCP call resolved purely from
 * the Spaces session cookie) failed if the user had never opened the
 * dashboard.
 *
 * `ensureUserExists(userId, caller)` plugs that gap: when a request lands
 * for a `userId` we don't have a row for, we look the profile up in the
 * Spaces DB and upsert it locally. Idempotent — repeat calls are cheap.
 * Returns true if the local row is present after the call, false if Spaces
 * doesn't know this user either (caller should treat that as a hard miss
 * and surface a normal 4xx).
 */

import { prisma } from "../db.js";
import { getSpacesUserById, type SpacesAuthCaller } from "./spaces-db.js";

import { createLogger } from "../logger.js";
const log = createLogger("users-jit");

export async function ensureUserExists(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<boolean> {
  if (!userId) return false;

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) return true;

  const spacesUser = await getSpacesUserById(userId, caller);
  if (!spacesUser) return false;

  // Upsert by id so concurrent JIT requests for the same user don't double-
  // insert. Update branch keeps the local copy in sync with email/name
  // changes on the Spaces side (rare but free).
  await prisma.user.upsert({
    where: { id: spacesUser.id },
    create: { id: spacesUser.id, email: spacesUser.email, name: spacesUser.name },
    update: { email: spacesUser.email, name: spacesUser.name },
  });

  log.info(`[users-jit] created local user ${spacesUser.email} (id=${spacesUser.id}) caller=${caller}`);
  return true;
}
