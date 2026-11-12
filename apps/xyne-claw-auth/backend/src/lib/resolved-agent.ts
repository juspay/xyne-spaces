import { botUserIdFor, type BotRef } from "./spaces-bot.js";

export interface ResolvedAgent {
  id: string;
  slug: string;
  /** Display name — the text a leftover "@Display Name" mention carries. */
  name: string;
  orgId: string;
  /** Posts as this agent's bot in Spaces (a fresh token per call). */
  bot: BotRef;
  spacesAppId: string;
  /** The agent's bot user in this workspace (sender of its messages). */
  spacesAppUserId: string;
  isDefault: boolean;
}

/**
 * The agent as it acts in one Spaces workspace, or null when it was not added
 * to that workspace (no principal), so it cannot post there.
 */
export async function toResolvedAgent(
  row: {
    id: string;
    slug: string;
    name: string | null;
    orgId: string;
    spacesAppId: string | null;
    isDefault: boolean;
  },
  workspaceId?: string | null,
): Promise<ResolvedAgent | null> {
  const bot: BotRef = { clawAgentId: row.id, workspaceId: workspaceId ?? null };
  const botUserId = await botUserIdFor(bot);
  if (!botUserId) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name ?? row.slug,
    orgId: row.orgId,
    bot,
    spacesAppId: row.spacesAppId ?? "",
    spacesAppUserId: botUserId,
    isDefault: row.isDefault,
  };
}
