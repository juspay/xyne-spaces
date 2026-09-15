import { prisma } from "../db.js";
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

export async function getDigitalTwinAgent(): Promise<ResolvedAgent | null> {
  const agent = await prisma.agent.findFirst({ where: { slug: "digital-twin", enabled: true } });

  if (!agent?.spacesAppToken || !agent.spacesAppId) return null;

  return {
    slug: agent.slug,
    id: agent.id,
    name: agent.name ?? agent.slug,
    orgId: agent.orgId,
    appToken: decryptStoredField(agent.spacesAppToken),
    spacesAppId: agent.spacesAppId,
    spacesAppUserId: agent.spacesAppUserId ?? "",
    isDefault: agent.isDefault,
  };
}
