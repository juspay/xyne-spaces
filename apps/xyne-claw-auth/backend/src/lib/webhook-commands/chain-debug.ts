import { prisma } from "../../db.js";
import { agentRepository } from "../../repositories/agentRepository.js";
import { agentRunRepository } from "../../repositories/agentRunRepository.js";
import { parseChainWorkflowDefinition } from "../chain-workflow.js";
import type { ChainWorkflowEdge, ChainWorkflowNode } from "../chain-workflow.js";
import type { WebhookCommandCtx } from "./context.js";

const REPLY_LABEL = "Failed to post /debug chain reply";

function tick(ok: boolean): string {
  return ok ? "✅" : "❌";
}

/**
 * Explain, for THIS channel + agent, every gate `dispatchAgentChain` passes
 * through before it hands off — in the same order the webhook evaluates them,
 * so the first ❌ is the reason nothing chained.
 *
 * Written because the failure is silent by construction: each gate returns
 * early with an info log, and a plan-mode turn never reaches the chain code at
 * all, so the thread shows a normal answer and no hint that a workflow existed.
 */
export async function handleChainDebug(ctx: WebhookCommandCtx): Promise<void> {
  const { channelId, conversationId, userId } = ctx.payload;
  const entryAgentSlug = ctx.agent.slug;
  const lines: string[] = [`🔗 **Chain debug** — channel \`${channelId}\`, agent \`${entryAgentSlug}\``, ""];

  const candidates = await prisma.channelAgentChainBinding.findMany({
    where: {
      entryAgentSlug,
      channelId: { in: [channelId, "*"] },
      userId: { in: [userId, "*"] },
    },
    include: { workflow: true },
  });

  if (candidates.length === 0) {
    lines.push(
      `${tick(false)} **No binding found** for entry agent \`${entryAgentSlug}\` on this channel.`,
      "",
      "A binding matches when `entryAgentSlug` equals the agent you @mention (the workflow's ENTRY AGENT), and its channel/user is either this one or the `*` wildcard.",
      "",
      "Bindings that exist for this agent on other channels:",
    );
    const elsewhere = await prisma.channelAgentChainBinding.findMany({
      where: { entryAgentSlug },
      include: { workflow: true },
      take: 10,
    });
    if (elsewhere.length === 0) {
      lines.push("- (none — this agent is not the entry agent of any workflow)");
    } else {
      for (const b of elsewhere) {
        lines.push(`- \`${b.workflow.name}\` → channel \`${b.channelId}\`, user \`${b.userId}\``);
      }
    }
    await ctx.reply(lines.join("\n"), REPLY_LABEL);
    return;
  }

  const rank = (r: { channelId: string; userId: string }): number =>
    (r.channelId === channelId ? 0 : 2) + (r.userId === userId ? 0 : 1);
  const usable = candidates.filter((r) => r.enabled && r.workflow.isPublished).sort((a, b) => rank(a) - rank(b));
  const binding = usable[0];

  lines.push(`**Bindings matched:** ${candidates.length} (most specific wins)`);
  for (const b of candidates) {
    const chosen = binding && b.id === binding.id ? " ← selected" : "";
    lines.push(
      `- \`${b.workflow.name}\` · enabled ${tick(b.enabled)} · published ${tick(b.workflow.isPublished)} · channel \`${b.channelId}\` · user \`${b.userId}\`${chosen}`,
    );
  }
  lines.push("");

  if (!binding) {
    lines.push(
      `${tick(false)} **Every matching binding is filtered out.** A binding must be *enabled* AND its workflow *published*. The "Active" chip in the editor is the binding — publishing is separate.`,
    );
    await ctx.reply(lines.join("\n"), REPLY_LABEL);
    return;
  }

  const workflow = parseChainWorkflowDefinition(binding.workflow.definition);
  if (!workflow) {
    lines.push(`${tick(false)} **Workflow definition is invalid** (id \`${binding.workflowId}\`) — it cannot be parsed, so the chain aborts.`);
    await ctx.reply(lines.join("\n"), REPLY_LABEL);
    return;
  }

  const fromNodes = workflow.nodes.filter((n: ChainWorkflowNode) => n.agentSlug === entryAgentSlug);
  const outgoing = workflow.edges.filter((e: ChainWorkflowEdge) => fromNodes.some((n: ChainWorkflowNode) => n.id === e.fromNodeId));
  lines.push(
    `${tick(true)} **Workflow** \`${binding.workflow.name}\` — ${workflow.nodes.length} node(s), ${workflow.edges.length} edge(s)`,
    `${tick(outgoing.length > 0)} **Outgoing edges from \`${entryAgentSlug}\`:** ${outgoing.length}`,
  );
  for (const e of outgoing) {
    const target = workflow.nodes.find((n: ChainWorkflowNode) => n.id === e.toNodeId);
    lines.push(`- → \`${target?.agentSlug ?? e.toNodeId}\` · mode \`${e.mode ?? "always"}\``);
  }
  if (outgoing.length === 0) {
    lines.push(
      "",
      "No edge starts at this agent, so there is nothing to hand off to. Check the workflow's ENTRY AGENT matches the agent you are mentioning.",
    );
  }
  lines.push("");

  const cfg = (await agentRepository.findBySlug(entryAgentSlug, ctx.agent.orgId ?? undefined))?.config as
    | Record<string, unknown>
    | undefined;
  const planMode = cfg?.["planMode"] === true;
  lines.push(
    `${tick(!planMode)} **Plan mode:** ${planMode ? "ON" : "off"}`,
  );
  if (planMode) {
    lines.push(
      "",
      "⚠️ **This is almost certainly why nothing chained.** With plan mode on, the first turn ends with an EMPTY result plus a plan card and returns before the chain runs — the judge is never consulted. Chaining resumes only on the turn AFTER the plan is approved. Turn plan mode off to chain on every turn.",
    );
  }
  lines.push("");

  const lastRun = conversationId
    ? await agentRunRepository.findLatestByConversation(conversationId, entryAgentSlug).catch(() => null)
    : null;
  if (lastRun) {
    lines.push(
      `**Last run:** \`${lastRun.sessionId}\` · status \`${lastRun.status}\``,
      "",
      "Grep claw-auth for what the chain decided on that run:",
      "```",
      `kubectl -n xyne-apps logs deploy/xyne-claw-auth --since=1h | grep 'Chain: '`,
      "```",
      "No `Chain:` line at all means the handler returned before chaining (plan card, experiment epoch, or an error).",
    );
  }

  await ctx.reply(lines.join("\n"), REPLY_LABEL);
}
