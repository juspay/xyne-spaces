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
import { SDLC_AGENT_SLUG } from "xyne-claw-shared";
import { sdlcAgentDesiredState } from "../src/lib/sdlc-agent-sync.js";

const prisma = new PrismaClient();

const DESIRED = sdlcAgentDesiredState();
const SDLC_AGENT_TOOL_ALLOWS = DESIRED.agentToolAllows;

async function main() {
  const askAi = process.env["SDLC_ORG_ID"]
    ? null
    : await prisma.agent.findFirst({ where: { slug: "ask-ai" }, select: { orgId: true } });
  const orgId = process.env["SDLC_ORG_ID"] ?? askAi?.orgId;
  if (!orgId) {
    throw new Error("Could not resolve target org: no ask-ai agent found and SDLC_ORG_ID not set");
  }

  const existing = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId, slug: SDLC_AGENT_SLUG } },
    select: { id: true },
  });
  if (existing) {
    console.log(`[provision-sdlc-agent] sdlc-agent already exists in org ${orgId} (id=${existing.id}) — leaving it untouched.`);
    return;
  }

  const sdlcAgent = await prisma.agent.create({
    data: {
      slug: SDLC_AGENT_SLUG,
      orgId,
      name: DESIRED.name,
      description: DESIRED.description,
      systemPrompt: DESIRED.systemPrompt,
      scope: DESIRED.scope,
      color: DESIRED.color,
      config: DESIRED.config,
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
