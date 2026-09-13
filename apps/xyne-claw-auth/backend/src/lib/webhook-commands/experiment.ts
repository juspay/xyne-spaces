import { errMsg } from "../errors.js";
import { experimentRepository } from "../../repositories/index.js";
import { isClawAdmin } from "../../middleware/agent-acl.js";
import {
  type ExperimentCommand,
  formatDuration,
  dispatchExperimentEpoch,
  EXPERIMENT_PROVIDERS,
  buildFindingsMarkdown,
  cancelRunSession,
  seedUnderstandingFrontier,
} from "../experiment.js";
import { buildExperimentProofBundle } from "../experiment-bundle.js";
import { resolveAuthForUser } from "../../services/userMemoryFetcher.js";
import { postGeneratedMarkdownFile } from "../spaces-generated-file.js";
import {
  capExperimentFindingsMarkdown,
  experimentCounts,
  experimentFindingsFilename,
  formatExperimentModel,
  formatExperimentStatus,
} from "./experiment-format.js";
import type { WebhookCommandCtx } from "./context.js";

const REPLY_LABEL = "Failed to post /experiment reply";

type ExperimentSub = ExperimentCommand["sub"];

type ExperimentHandlers = {
  [K in ExperimentSub]: (
    ctx: WebhookCommandCtx,
    command: Extract<ExperimentCommand, { sub: K }>,
  ) => Promise<void>;
};

const handlers: ExperimentHandlers = {
  unknown: async (ctx) => {
    await ctx.reply([
      "/experiment <duration> [provider=…] [model=…] [focus…]",
      "/understanding [duration cap] [focus…] — coverage-gated: runs until the code-path frontier is exhausted",
      "/experiment status",
      "/experiment list",
      "/experiment findings [id]",
      "/experiment stop",
    ].join("\n"), REPLY_LABEL);
  },

  status: async (ctx) => {
    const run = await experimentRepository.findActiveByConversation(ctx.payload.conversationId);
    const findings = run ? await experimentRepository.listFindings(run.id) : [];
    await ctx.reply(formatExperimentStatus(run, findings), REPLY_LABEL);
  },

  stop: async (ctx) => {
    const { payload, log } = ctx;
    const run = await experimentRepository.findActiveByConversation(payload.conversationId);
    if (!run) {
      await ctx.reply("No active /experiment to stop.", REPLY_LABEL);
      return;
    }
    const allowed = run.userId === payload.userId || await isClawAdmin(payload.userId);
    if (!allowed) {
      await ctx.reply("Only the requester or a claw admin can stop this /experiment.", REPLY_LABEL);
      return;
    }
    await experimentRepository.update(run.id, { status: "aborted", lastEpochEndedAt: new Date() });
    // Cancel in-flight CHECKER sessions too. They never claim
    // currentSessionId (claiming it would chain the next epoch off their
    // completion), so before this they survived stop and kept posting into
    // the thread after the run was already aborted.
    let cancelledCheckers = 0;
    for (const checkerSessionId of run.checkerSessionIds ?? []) {
      try {
        await cancelRunSession(checkerSessionId, run.userId);
        cancelledCheckers++;
      } catch {
        // Already finished or unknown to claw — nothing to cancel.
      }
    }
    let cancelledEpoch = false;
    if (run.currentSessionId) {
      try {
        await cancelRunSession(run.currentSessionId, run.userId);
        cancelledEpoch = true;
      } catch (err) {
        log.warn("[experiment] failed to cancel running epoch", {
          experimentId: run.id,
          sessionId: run.currentSessionId,
          error: errMsg(err),
        });
      }
    }
    const stoppedParts = [
      ...(cancelledEpoch ? ["cancelled the running epoch"] : []),
      ...(cancelledCheckers > 0 ? [`cancelled ${cancelledCheckers} checker run${cancelledCheckers === 1 ? "" : "s"}`] : []),
    ];
    await ctx.reply(stoppedParts.length > 0
      ? `Stopped /experiment (${stoppedParts.join(", ")}).`
      : "Stopped /experiment.", REPLY_LABEL);
  },

  list: async (ctx) => {
    // Thread-scoped, no ownership gate — same visibility as /experiment
    // status. The run ids printed here are what `/experiment findings <id>`
    // takes, and THAT path does gate on owner/admin.
    const runs = await experimentRepository.listRecentByConversationWithFindingCounts(ctx.payload.conversationId, 15);
    if (runs.length === 0) {
      await ctx.reply("No /experiment has run in this thread.", REPLY_LABEL);
      return;
    }
    const rows = runs.map((run) => {
      const started = run.createdAt.toISOString().slice(0, 16).replace("T", " ");
      const model = run.provider ? ` · ${formatExperimentModel(run.provider, run.modelId)}` : "";
      const live = run.status === "running" || run.status === "finishing" ? " ← active" : "";
      return `\`${run.id}\` — ${run.status}, ${run._count.findings} findings, epoch ${run.epoch}${model} · ${started}${live}`;
    });
    await ctx.reply([
      `**/experiment list** — ${runs.length} run${runs.length === 1 ? "" : "s"} in this thread`,
      "",
      ...rows,
      "",
      "Pull any one with `/experiment findings <id>`.",
    ].join("\n"), REPLY_LABEL);
  },

  findings: async (ctx, experimentCommand) => {
    const { agent, payload, log } = ctx;
    const run = experimentCommand.id
      ? await experimentRepository.findById(experimentCommand.id)
      : await experimentRepository.findBestForFindings(payload.conversationId);
    if (!run) {
      await ctx.reply(experimentCommand.id
        ? "Experiment not found."
        : "No /experiment has run in this thread.", REPLY_LABEL);
      return;
    }
    if (experimentCommand.id && run.userId !== payload.userId && !(await isClawAdmin(payload.userId))) {
      await ctx.reply("Not your experiment.", REPLY_LABEL);
      return;
    }
    const [findings, reviews] = await Promise.all([
      experimentRepository.listFindings(run.id),
      experimentRepository.listReviews(run.id),
    ]);
    const recentRuns = await experimentRepository.listRecentByConversationWithFindingCounts(payload.conversationId);
    const counts = experimentCounts(findings);
    const summaryLines = [
      `**/experiment findings** — ${run.agentSlug}`,
      `Status: ${run.status} · Epoch: ${run.epoch} · Findings: ${counts.proved} proved, ${counts.conjecture} open, ${counts.refuted} refuted`,
    ];
    if (!experimentCommand.id && recentRuns[0] && recentRuns[0].id !== run.id) {
      summaryLines.push(`(showing experiment ${run.id} — the most recent run in this thread had no findings)`);
    }
    const otherRuns = recentRuns.filter((candidate) => candidate.id !== run.id).slice(0, 5);
    if (recentRuns.length > 1 && otherRuns.length > 0) {
      summaryLines.push(`Other runs in this thread: ${otherRuns.map((candidate) =>
        `${candidate.id} (${candidate.status}, ${candidate._count.findings} findings, ${candidate.createdAt.toISOString().slice(0, 10)})`
      ).join(" · ")}`);
    }
    const markdown = capExperimentFindingsMarkdown(buildFindingsMarkdown(run, findings, reviews));
    const filename = experimentFindingsFilename(run.agentSlug);

    // Prefer ONE zip laid out by epoch over a bare .md: the proof artifacts
    // are otherwise scattered across hours of thread messages, and a proof
    // you can't locate is a proof you don't have. Falls back to the markdown
    // when the thread has no attachments or Spaces is unreachable.
    let bundle: Awaited<ReturnType<typeof buildExperimentProofBundle>> = null;
    try {
      // Reads the thread's attachments as the REQUESTER, so the bundle can
      // never contain a file they couldn't already open in the thread.
      const bundleAuth = await resolveAuthForUser(payload.userId);
      if (!bundleAuth) {
        log.warn("[experiment] no Spaces credentials for requester; findings will be markdown-only", {
          userId: payload.userId,
        });
      } else {
        bundle = await buildExperimentProofBundle({
          run,
          findings,
          findingsMarkdown: markdown,
          conversationId: payload.conversationId,
          auth: bundleAuth,
        });
      }
    } catch (err) {
      log.warn("[experiment] proof bundle failed; falling back to markdown only", {
        error: errMsg(err),
      });
    }
    if (bundle) {
      summaryLines.push(
        `Proof bundle: ${bundle.includedCount} of ${bundle.entries.length} findings have their artifact attached` +
        (bundle.missingCount > 0 ? ` · ${bundle.missingCount} missing (see MANIFEST.md)` : "") +
        ` — organised by epoch inside the zip. The findings write-up is also attached as ${filename}.`,
      );
    }
    const summary = summaryLines.join("\n");
    try {
      await postGeneratedMarkdownFile({
        channelId: payload.channelId,
        conversationId: payload.conversationId,
        userId: agent.spacesAppUserId,
        appToken: agent.appToken,
        filename: bundle ? bundle.filename : filename,
        markdown: bundle ? bundle.buffer : markdown,
        ...(bundle ? { mimeType: "application/zip" } : {}),
        // Ship the readable findings .md alongside the zip. The zip is the
        // complete archive (proof artifacts organised by epoch), but nobody
        // wants to download-and-unzip just to read the write-up — so the
        // markdown rides the same message, exactly as it did before bundling.
        ...(bundle ? { extraFiles: [{ filename, content: markdown, mimeType: "text/markdown" }] } : {}),
        summary,
      });
    } catch (err) {
      log.warn("[experiment] findings file upload failed; posting inline fallback", {
        error: errMsg(err),
      });
      await ctx.reply(`${summary}\n\n⚠️ _Couldn't attach ${bundle ? bundle.filename : filename} (upload failed); posting the markdown inline._\n\n${markdown}`, REPLY_LABEL);
    }
  },

  start: async (ctx, experimentCommand) => {
    const { agent, payload, log } = ctx;
    if (experimentCommand.invalidProvider !== undefined) {
      await ctx.reply([
        `Invalid /experiment provider: ${experimentCommand.invalidProvider || "(empty)"}`,
        `Valid providers: ${Array.from(EXPERIMENT_PROVIDERS).join(", ")}`,
      ].join("\n"), REPLY_LABEL);
      return;
    }

    const existing = await experimentRepository.findActiveByConversation(payload.conversationId);
    if (existing) {
      await ctx.reply("An active /experiment is already running in this thread. Use `/experiment status` or `/experiment stop`.", REPLY_LABEL);
      return;
    }
    const run = await experimentRepository.createRun({
      conversationId: payload.conversationId,
      channelId: payload.channelId,
      agentSlug: agent.slug,
      userId: payload.userId,
      orgId: agent.orgId,
      focus: experimentCommand.focus ?? null,
      provider: experimentCommand.provider ?? null,
      modelId: experimentCommand.model ?? null,
      kind: experimentCommand.kind ?? null,
      deadlineAt: new Date(Date.now() + experimentCommand.durationMs),
    });
    const isUnderstanding = experimentCommand.kind === "understanding";
    // Seed the frontier from a list the user already gave us (e.g. 57 table
    // names). Ground truth beats model enumeration: with the paths pre-recorded
    // the run cannot exit by imagining fewer of them.
    const seededPaths = isUnderstanding
      ? await seedUnderstandingFrontier(run.id, experimentCommand.focus).catch(() => 0)
      : 0;
    await ctx.reply([
      isUnderstanding ? "**/understanding started**" : "**/experiment started**",
      isUnderstanding
        ? `Mode: coverage-gated understanding loop (ends when the code-path frontier is exhausted)`
        : `Mode: time-boxed autonomous exploration`,
      `${isUnderstanding ? "Safety cap" : "Duration"}: ${formatDuration(experimentCommand.durationMs)}`,
      ...(experimentCommand.provider ? [`Model: ${formatExperimentModel(experimentCommand.provider, experimentCommand.model)}`] : []),
      seededPaths > 0
        ? `Frontier: ${seededPaths} path(s) seeded from your list — the run ends when all of them are closed.`
        : `Focus: ${experimentCommand.focus?.trim() || "(none)"}`,
      // Never drop part of the user's scope in silence: the old cap cut a
      // 57-table list mid-word and the run explored a narrower scope than the
      // user believed they had asked for.
      ...(experimentCommand.droppedFocus
        ? [`⚠️ Focus was too long — this was NOT included: \`${experimentCommand.droppedFocus.slice(0, 400)}\`${experimentCommand.droppedFocus.length > 400 ? " …" : ""}\nStart a second run for the remainder, or shorten the focus.`]
        : []),
      `Use \`/experiment status\` to inspect progress.`,
    ].join("\n"), REPLY_LABEL);
    try {
      await dispatchExperimentEpoch(run);
    } catch (err) {
      // A silent failure here strands a zombie "active" run that blocks every
      // future /experiment in this thread. Abort it and tell the user why.
      const msg = errMsg(err);
      log.warn("[experiment] initial dispatch failed", { error: msg });
      await experimentRepository.update(run.id, { status: "aborted", lastEpochEndedAt: new Date() }).catch(() => undefined);
      await ctx.reply(`⚠️ /experiment could not start: ${msg.slice(0, 300)}\nThe experiment was aborted — fix the issue and start again.`, REPLY_LABEL);
    }
  },
};

export async function handleExperimentCommand(
  ctx: WebhookCommandCtx,
  command: ExperimentCommand,
): Promise<void> {
  const handler = handlers[command.sub] as (
    ctx: WebhookCommandCtx,
    command: ExperimentCommand,
  ) => Promise<void>;
  await handler(ctx, command);
}
