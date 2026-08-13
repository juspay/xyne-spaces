/**
 * One-off prod provisioner for the sdlc-agent (XYNE-55471).
 *
 * The full `prisma/seed.ts` is NOT safe to run against prod — its `update:`
 * blocks overwrite live-tuned prompts/configs of every seeded agent. This
 * script replicates ONLY the sdlc-agent portion of the seed, and is
 * CREATE-ONLY for the agent row: if `sdlc-agent` already exists in the target
 * org it exits without touching it.
 *
 * Org resolution: the org that hosts the `ask-ai` agent (there is exactly one
 * in prod). Override with SDLC_ORG_ID when that assumption breaks.
 *
 * Run inside the claw-auth pod (DATABASE_URL comes from the pod env):
 *   npx tsx scripts/provision-sdlc-agent.ts
 */
import { PrismaClient } from "@prisma/client";
import { buildSdlcAgentToolProfile } from "xyne-claw-shared";
import { tools as xyneSpacesTools } from "../src/mcp/servers/xyne-spaces-tools.js";

const prisma = new PrismaClient();

const SDLC_TOOL_PROFILE = buildSdlcAgentToolProfile(
  xyneSpacesTools.map((tool) => tool.name),
);

const SDLC_AGENT_PROMPT = `You are **SDLC Assistant** — the focused engineering agent for repository-backed software delivery in Xyne Spaces.

Every repository operation must use the SDLC repository pinned by trusted run context. Never infer a repository from its display name, search Spaces to discover one, or select a repository from an error message. If no valid SDLC repository context is attached, explain that the user must select a repository from an SDLC Hub and stop without calling repository or artifact tools.

For baseline work, use sandbox-repo-setup for the pinned repository, search the pinned repository channel for relevant imported Wiki canvases with spaces-search, read their full content with spaces-read-canvas, and verify their claims against the live repository. Then use spaces-sdlc-mutate-artifact with artifactType BASELINE to begin one draft, checkpoint each required section immediately after its focused inspection, and finalize only after all sections are present. Cite exact relative paths and symbols, distinguish source evidence from inference, and record Wiki/source disagreements with the live repository treated as authoritative. If repository setup or source inspection fails, report the failure and leave the resumable draft unfinalized.

Create PRDs and Tech Docs only with spaces-sdlc-mutate-artifact and action create. A Tech Doc requires its parent PRD. Never use a generic canvas for an SDLC artifact. Repository access and SDLC Hub membership are mandatory; treat an authorization failure as terminal.

When historical context is relevant, read the current artifact first, list a bounded page of versions with spaces-sdlc-list-artifact-versions, and read only the needed snapshot with spaces-sdlc-read-artifact-version. Never treat old artifact text as more authoritative than current repository evidence.

For implementation work, modify only the pinned repository and requested branch, run relevant existing checks, avoid unrelated changes, never expose secrets, and never claim a push or pull request succeeded without verification.`;

const SDLC_AGENT_TOOL_ALLOWS = SDLC_TOOL_PROFILE.agentToolAllows;

async function main() {
  const askAi = process.env["SDLC_ORG_ID"]
    ? null
    : await prisma.agent.findFirst({ where: { slug: "ask-ai" }, select: { orgId: true } });
  const orgId = process.env["SDLC_ORG_ID"] ?? askAi?.orgId;
  if (!orgId) {
    throw new Error("Could not resolve target org: no ask-ai agent found and SDLC_ORG_ID not set");
  }

  const existing = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId, slug: "sdlc-agent" } },
    select: { id: true },
  });
  if (existing) {
    console.log(`[provision-sdlc-agent] sdlc-agent already exists in org ${orgId} (id=${existing.id}) — leaving it untouched.`);
    return;
  }

  const sdlcAgent = await prisma.agent.create({
    data: {
      slug: "sdlc-agent",
      orgId,
      name: "SDLC Assistant",
      description: "Repository-grounded baselines, PRDs, Tech Docs, and implementation workflows.",
      systemPrompt: SDLC_AGENT_PROMPT,
      scope: "global",
      color: "#2563eb",
      config: {
        requireSdlcRepository: true,
        tools: {
          subagents: SDLC_TOOL_PROFILE.tools.subagents,
          direct: SDLC_TOOL_PROFILE.tools.direct,
          custom: SDLC_TOOL_PROFILE.tools.custom,
        },
        toolPermissions: SDLC_TOOL_PROFILE.toolPermissions,
      },
    },
  });
  console.log(`[provision-sdlc-agent] Created sdlc-agent id=${sdlcAgent.id} org=${orgId}`);

  // Same provider inheritance as seed.ts: clone ask-ai's SHARED credential
  // bindings (shared refs only — never copies encrypted key material).
  const askAiAgent = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId, slug: "ask-ai" } },
    select: { id: true },
  });
  const sharedBindings = askAiAgent
    ? await prisma.agentProviderCredentials.findMany({
        where: { agentId: askAiAgent.id, sharedCredentialId: { not: null } },
      })
    : [];
  for (const binding of sharedBindings) {
    await prisma.agentProviderCredentials.create({
      data: {
        agentId: sdlcAgent.id,
        provider: binding.provider,
        sharedCredentialId: binding.sharedCredentialId,
        encryptedKey: null,
        iv: null,
        authTag: null,
        model: binding.model,
        baseUrl: binding.baseUrl,
        authType: binding.authType,
        reasoningEffort: binding.reasoningEffort,
        createdByUserId: binding.createdByUserId,
      },
    });
  }
  if (sharedBindings.length > 0) {
    const config = sdlcAgent.config as Record<string, unknown>;
    await prisma.agent.update({
      where: { id: sdlcAgent.id },
      data: {
        config: {
          ...config,
          provider: sharedBindings[0]!.provider,
          providerOrder: sharedBindings.map((binding) => binding.provider),
        },
      },
    });
  }

  let toolRows = 0;
  for (const slug of SDLC_AGENT_TOOL_ALLOWS) {
    const tool = await prisma.tool.findUnique({ where: { slug } });
    if (!tool) {
      console.warn(`[provision-sdlc-agent] Tool row missing for slug "${slug}" — skipped (run the tool seed if this matters)`);
      continue;
    }
    await prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId: sdlcAgent.id, toolId: tool.id } },
      create: { agentId: sdlcAgent.id, toolId: tool.id, permission: "allow" },
      update: { permission: "allow" },
    });
    toolRows++;
  }
  console.log(`[provision-sdlc-agent] Done. Provider bindings=${sharedBindings.length} agentTool allows=${toolRows}/${SDLC_AGENT_TOOL_ALLOWS.length}`);
}

main()
  .catch((err) => {
    console.error("[provision-sdlc-agent] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
