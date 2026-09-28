import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("skill-apply");

/** "agent-tools" is current; "skill" is kept so cards signed before the tool
 *  moved groups still apply. */
export function isCreateSkillAction(serverType: string, tool: string): boolean {
  return serverType === "skill" || (serverType === "agent-tools" && tool === "create-skill");
}

/** `invalid` leaves the card in place — malformed params, so no approval of
 *  them can succeed. `duplicate` is terminal. */
export type SkillApplyOutcome =
  | { status: "created"; name: string; slug: string; message: string }
  | { status: "invalid"; error: string }
  | { status: "duplicate"; error: string };

/** `userId` is the approver; the caller has already verified it signed the
 *  action, so params are trusted here. */
export async function applyCreateSkill(
  params: Record<string, unknown>,
  userId: string,
): Promise<SkillApplyOutcome> {
  const { skillRepository } = await import("../repositories/index.js");
  const name = String(params["name"] ?? "").trim();
  const description = String(params["description"] ?? "").trim();
  const content = String(params["content"] ?? "");
  let slug = String(params["slug"] ?? "").trim().toLowerCase();
  if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

  if (!name || !content.trim() || !slug) {
    return { status: "invalid", error: "Skill name, slug and content are required." };
  }
  if (!/^[a-z0-9-]+$/.test(slug) || slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) {
    return {
      status: "invalid",
      error: "Invalid skill slug (use lowercase letters, digits and single hyphens).",
    };
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  const skillOrgId = user?.orgId;
  if (!skillOrgId) {
    return { status: "invalid", error: "Could not resolve your organization to create the skill." };
  }

  const existing = await skillRepository.findBySlug(slug, skillOrgId);
  if (existing) {
    return { status: "duplicate", error: `A skill with slug "${slug}" already exists.` };
  }

  await skillRepository.create({
    slug,
    name,
    description,
    content: content.trim(),
    source: "agent-authored",
    scope: "personal",
    owner: { connect: { id: userId } },
    org: { connect: { id: skillOrgId } },
  });
  log.info(`[skill-apply] create-skill approved slug=${slug} owner=${userId} org=${skillOrgId}`);
  return { status: "created", name, slug, message: `Skill "${name}" created.` };
}
