/**
 * Spaces-backed implementations of the MentionLookups used by
 * resolveUnboundMentions. Shared by every result-posting path that wants
 * deterministic tagging (webhook results, scheduled-job results) so the
 * lookup behavior can't drift between them.
 *
 * All lookups use take/limit=2 so a multi-match comes back as length 2 and
 * the resolver treats it as ambiguous (no rewrite, no false pings).
 */

import type { MentionLookups } from "./mention-transform.js";
import {
  getSpacesGroupByAlias,
  getSpacesUsersByName,
  getSpacesUserByEmail,
  getSpacesUsersByHandle,
} from "./spaces-db.js";
import { createLogger } from "../logger.js";

const log = createLogger("mention-lookups");

/**
 * DB-backed mention lookups — read `public.users` directly. Needs no token and
 * no workspace scope (email is @unique; names resolve only when EXACTLY one
 * active human matches). Requires SPACES_DB_URL to be configured.
 */
export function buildSpacesMentionLookupsDb(workspaceId?: string): MentionLookups {
  log.info(`[mention-lookups] using db lookups workspaceId=${workspaceId ?? "(none)"}`);
  return {
    // Scope ALL people lookups to the agent's workspace when known. Names AND
    // emails/handles collide across workspaces (the same person is imported into
    // multiple workspaces, one users row each), so an unscoped email/handle
    // returns ≥2 rows and the resolver leaves the @mention untagged — the prod
    // bug where @email never resolved while @Name did.
    byName: (name) => getSpacesUsersByName(name, workspaceId),
    byEmail: (email) => getSpacesUserByEmail(email, workspaceId),
    byHandle: (handle) => getSpacesUsersByHandle(handle, workspaceId),
    byGroupAlias: getSpacesGroupByAlias,
  };
}

export interface SpacesMentionAuth {
  /** Spaces user JWT of the human on whose behalf we search. */
  token: string;
  /** Session row id — sent as cookie for Spaces' legacy session checks. */
  sessionId?: string;
  /** Workspace scope for the searches. */
  workspaceId?: string;
}

export function buildSpacesMentionLookups(auth: SpacesMentionAuth): MentionLookups {
  return buildSpacesMentionLookupsDb(auth.workspaceId);
}
