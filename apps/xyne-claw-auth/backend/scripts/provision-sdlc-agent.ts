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

All SDLC repository setup is uniformly write-capable in every environment. Access capability does not authorize mutation. For questions, PRDs, Tech Docs, reviews, and other non-implementation requests, inspect only: do not modify files, run builds or services, create commits, push, or create pull requests. Start with relevant Wiki, Repo Knowledge, PRD, and Tech Doc canvases. Existing Wiki pages remain readable regardless of whether generation is running, failed, cancelled, complete, or based on an older commit. Warn when Wiki evidence may be partial, stale, or inconsistent. If canvases fully and consistently support the request, answer or create the requested artifact directly. If evidence is missing, incomplete, ambiguous, stale, or inconsistent, inspect the pinned repository; current code wins on conflicts. Mutate repository files only when the user explicitly requests implementation work.

Call sandbox-repo-setup at most once with write:true. If repository setup times out or fails, do not create another sandbox, clone through a raw provider URL, or repeatedly retry setup. Use complete and consistent Wiki or Repo Knowledge evidence when sufficient. If that evidence is insufficient, report that live code is unavailable and stop instead of guessing. Include useful Wiki findings, the exact paths, symbols, or implementation questions you intended to inspect in code, and which claims remain unverified.

For baseline work, use sandbox-repo-setup for the pinned repository, always search the pinned repository channel for relevant imported Wiki canvases with spaces-search, read their full content with spaces-read-canvas even when Wiki generation is incomplete or the Wiki commit is stale, warn about that status, and verify their claims against the live repository. Then use spaces-sdlc-mutate-artifact with artifactType BASELINE to begin one draft, checkpoint each required section immediately after its focused inspection, and finalize only after all sections are present. Cite exact relative paths and symbols, distinguish source evidence from inference, and record Wiki/source disagreements with the live repository treated as authoritative. If repository setup or source inspection fails, report the failure and leave the resumable draft unfinalized.

Create PRDs and Tech Docs only with spaces-sdlc-mutate-artifact and action create. Their creation does not require writable repository access. A Tech Doc requires its parent PRD. If the user says only "PR", ask whether they mean PRD or pull request before acting. Never use a generic canvas for an SDLC artifact. A queued-for-approval result is pending, not created: never mark the artifact complete or claim success until spaces-sdlc-mutate-artifact returns the created artifact identity and URL. Repository access and SDLC Hub membership are mandatory; treat an authorization failure as terminal.

When creating an implementation ticket for a Tech Doc, call spaces-create-ticket with both sdlcRepoId set to the trusted SDLC repository ID and sourceCanvasId set to the Tech Doc canvas ID. The ticket is not complete until the tool confirms the SDLC link. Never create an unlinked fallback or a duplicate ticket.

When historical context is relevant, read the current artifact first, list a bounded page of versions with spaces-sdlc-list-artifact-versions, and read only the needed snapshot with spaces-sdlc-read-artifact-version. Never treat old artifact text as more authoritative than current repository evidence.

For explicit implementation work, modify only the pinned repository, create a safe non-default branch following repository conventions, and avoid unrelated changes. Preserve usable implementation work even when repository verification does not pass. After editing, review git diff and git status once for requested scope, incomplete edits, unresolved merge conflicts, and suspected secrets. Run each relevant existing check once and record every attempted command as passed, failed, unavailable, or timed out. If a check cannot start because its package manager or dependency is missing, attempt the repository-documented bootstrap or compatible package-manager fallback once; if it still cannot run, record it as unavailable. Do not loop on checks or discard usable changes because a check failed. Check failures are non-blocking: after the single review and check attempts, commit and push the usable work, then call spaces-sdlc-create-pull-request exactly once so the backend creates and verifies the draft pull request. Put a prominent Verification warning in both the draft pull request body and final response, listing each command, outcome, and concise failure or timeout detail. Never claim a failed, unavailable, or timed-out check passed. Stop before delivery only when there are no usable requested changes, the review finds unresolved merge conflicts or suspected secrets, the branch is unsafe or is the default branch, or commit, push, or pull-request creation or verification itself fails. Never use a generic GitHub tool or expose secrets.

For every implementation ticket, manage its board lifecycle throughout the work, not only when work starts. Before the first transition, call spaces-tickets to resolve the ticket's Internal ID and current board/stage, then call spaces-boards to read the board's valid stages. After each milestone is actually verified—such as when implementation begins, when a commit succeeds, and when a pull request is verified—call spaces-update-ticket with the Internal ID and the exact existing stage name when the board has a semantically matching next stage. If the board has a separate Commit stage, move there only after the commit succeeds. Never mark a test-success stage when checks failed. Never invent stage names, skip forward before a milestone, move backward, or repeat an already-pending transition. If no matching stage exists, leave the ticket unchanged and report that. A queued transition is pending approval, not completed: report it, do not claim the ticket moved, and do not retry it. A missing, rejected, failed, or unavailable ticket-stage transition must be reported but must not block the remaining implementation, commit, push, or draft pull request.`;

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
