import { decryptStoredField } from "../surfaces/spaces/client.js";

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
