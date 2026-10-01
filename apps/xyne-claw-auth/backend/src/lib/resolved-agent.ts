import { decryptStoredField } from "../surfaces/spaces/client.js";
import { resolveSpacesAppCreds } from "./spaces-agent-install.js";

export interface ResolvedAgent {
  id: string;
  slug: string;
  /** Display name — the text a leftover "@Display Name" mention carries. */
  name: string;
  orgId: string;
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  isDefault: boolean;
}

export function toResolvedAgent(row: {
  id: string;
  slug: string;
  name: string | null;
  orgId: string;
  spacesAppToken: string | null;
  spacesAppId: string | null;
  spacesAppUserId: string | null;
  isDefault: boolean;
}): ResolvedAgent | null {
  return row.spacesAppToken && row.spacesAppId
    ? {
        id: row.id,
        slug: row.slug,
        name: row.name ?? row.slug,
        orgId: row.orgId,
        appToken: decryptStoredField(row.spacesAppToken),
        spacesAppId: row.spacesAppId,
        spacesAppUserId: row.spacesAppUserId ?? "",
        isDefault: row.isDefault,
      }
    : null;
}

/** Workspace-aware variant: bot token+user for `workspaceId` when the webhook
 *  payload carries it (SurfaceAgentInstall); the inline columns hold only the
 *  latest install's pair and stay the fallback. */
export async function toResolvedAgentForWorkspace(
  row: Parameters<typeof toResolvedAgent>[0],
  workspaceId?: string | null,
): Promise<ResolvedAgent | null> {
  if (!row.spacesAppId || !row.spacesAppToken) return null;
  const creds = await resolveSpacesAppCreds(row, workspaceId);
  if (!creds.spacesAppToken) return null;
  return toResolvedAgent({ ...row, spacesAppToken: creds.spacesAppToken, spacesAppUserId: creds.spacesAppUserId });
}
