import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { experimentRepository } from "../repositories/index.js";
import { proofWasDelivered } from "../repositories/experimentRepository.js";
import { buildLedgerMarkdown, postExperimentNotice } from "../lib/experiment.js";
import { createLogger } from "../logger.js";
import { hasResolvableCitation } from "../lib/experiment-text.js";

export const experimentsInternalRouter = Router();
const log = createLogger("experiments-internal");

function counts(findings: Array<{ status: string }>): { conjecture: number; proved: number; refuted: number } {
  return {
    conjecture: findings.filter((f) => f.status === "conjecture").length,
    proved: findings.filter((f) => f.status === "proved").length,
    refuted: findings.filter((f) => f.status === "refuted").length,
  };
}

function notFound(res: Response): void {
  res.status(404).json({ success: false, error: "experiment not found" });
}

function validStatus(value: unknown): value is "conjecture" | "proved" | "refuted" {
  return value === "conjecture" || value === "proved" || value === "refuted";
}

experimentsInternalRouter.get("/:id/ledger", async (req: Request<{ id: string }>, res: Response) => {
  const run = await experimentRepository.findById(req.params.id);
  if (!run) return notFound(res);
  const findings = await experimentRepository.listFindings(run.id);
  res.json({
    success: true,
    data: {
      markdown: buildLedgerMarkdown(run, findings),
      counts: counts(findings),
      deadlineAt: run.deadlineAt.toISOString(),
      epoch: run.epoch,
      // Exposed so the claw-side end-experiment gate can enforce the
      // understanding-run deliverable (a delivered .html) against real state
      // rather than the model's word.
      deliveredArtifacts: run.deliveredArtifacts,
    },
  });
});

experimentsInternalRouter.post("/:id/findings", async (req: Request<{ id: string }>, res: Response) => {
  const run = await experimentRepository.findById(req.params.id);
  if (!run) return notFound(res);
  const body = req.body as {
    epoch?: unknown;
    status?: unknown;
    title?: unknown;
    hypothesis?: unknown;
    note?: unknown;
    proofArtifactPath?: unknown;
  };
  if (typeof body.epoch !== "number" || !validStatus(body.status) || typeof body.title !== "string" || typeof body.hypothesis !== "string") {
    res.status(400).json({ success: false, error: "invalid finding body" });
    return;
  }
  // PROOF DURABILITY GATE. `proved` requires an artifact that was actually
  // delivered to the thread. Measured on the first three live runs: 125 of 129
  // proofArtifactPaths pointed at /workspace/... inside sandboxes that were
  // later destroyed, so every "proved" finding cited a file nobody could open.
  // A claim whose evidence is gone is a conjecture, so that is what we store —
  // the finding is kept, only the label is refused, and the agent is told
  // exactly how to earn it back.
  //
  // UNDERSTANDING RUNS PROVE DIFFERENTLY. A coverage-gated run closes a code
  // path by explaining it with file:line evidence — there is no repro artifact
  // to deliver, and demanding one made the mode unusable: every close was
  // downgraded to conjecture, so `open` could never reach 0 and the frontier
  // could never be exhausted. The durability concern still applies, it just has
  // a different answer here: a `path/file.ext:123` citation is checkable
  // against the repo forever, whereas /workspace/... dies with the sandbox.
  let status = body.status;
  let downgradeNote: string | null = null;
  const understanding = run.kind === "understanding";
  if (understanding && status === "proved" && !hasResolvableCitation(body.note)) {
    status = "conjecture";
    downgradeNote =
      "Recorded as conjecture, NOT closed: no file:line evidence. Cite where the behaviour actually lives (e.g. `src/foo/bar.ts:214`) in `note`, describing what the code does and why, then record this path again.";
  } else if (!understanding && status === "proved" && !proofWasDelivered(body.proofArtifactPath as string | null, run.deliveredArtifacts)) {
    status = "conjecture";
    downgradeNote = body.proofArtifactPath
      ? `Recorded as conjecture, NOT proved: ${String(body.proofArtifactPath)} was never delivered to the thread. Call sandbox-deliver-files with that exact path, then record this finding again with proofArtifactPath set to the delivered filename.`
      : "Recorded as conjecture, NOT proved: no proofArtifactPath given. Produce a repro/test/benchmark, deliver it with sandbox-deliver-files, then record this finding again with proofArtifactPath set to the delivered filename.";
  }

  // Length caps: findings feed straight into every later epoch's task prompt
  // (buildLedgerMarkdown), so uncapped text compounds across an 8h run.
  const row = await experimentRepository.upsertFindingByTitle({
    experimentId: run.id,
    epoch: body.epoch,
    status,
    title: body.title.slice(0, 200),
    hypothesis: body.hypothesis.slice(0, 2000),
    note: typeof body.note === "string" ? body.note.slice(0, 2000) : null,
    proofArtifactPath: typeof body.proofArtifactPath === "string" ? body.proofArtifactPath.slice(0, 500) : null,
  });
  res.json({ success: true, data: { id: row.id, status, ...(downgradeNote ? { warning: downgradeNote } : {}) } });
});

const REVIEW_VERDICTS = new Set(["confirms", "contradicts", "stale", "duplicate", "unverifiable"]);

experimentsInternalRouter.post("/:id/reviews", async (req: Request<{ id: string }>, res: Response) => {
  const run = await experimentRepository.findById(req.params.id);
  if (!run) return notFound(res);
  const body = req.body as { findingId?: unknown; epoch?: unknown; verdict?: unknown; reason?: unknown; duplicateOf?: unknown };
  if (
    typeof body.findingId !== "string" ||
    typeof body.epoch !== "number" ||
    typeof body.verdict !== "string" ||
    !REVIEW_VERDICTS.has(body.verdict) ||
    typeof body.reason !== "string"
  ) {
    res.status(400).json({ success: false, error: "invalid review body" });
    return;
  }
  // The finding must belong to THIS experiment — a checker must not be able to
  // write verdicts onto another run's ledger by guessing a cuid.
  const finding = await experimentRepository.findFindingById(body.findingId);
  if (!finding || finding.experimentId !== run.id) {
    res.status(404).json({ success: false, error: "finding not found in this experiment" });
    return;
  }
  const row = await experimentRepository.upsertReview({
    experimentId: run.id,
    findingId: body.findingId,
    epoch: body.epoch,
    verdict: body.verdict,
    reason: body.reason,
    duplicateOf: typeof body.duplicateOf === "string" ? body.duplicateOf : null,
  });
  res.json({ success: true, data: { id: row.id } });
});

experimentsInternalRouter.post("/:id/delivered", async (req: Request<{ id: string }>, res: Response) => {
  const run = await experimentRepository.findById(req.params.id);
  if (!run) return notFound(res);
  const body = req.body as { filenames?: unknown };
  const filenames = Array.isArray(body.filenames)
    ? body.filenames.filter((name): name is string => typeof name === "string").slice(0, 50)
    : null;
  if (!filenames || filenames.length === 0) {
    res.status(400).json({ success: false, error: "invalid delivered body" });
    return;
  }
  const merged = await experimentRepository.recordDeliveredArtifacts(run.id, filenames);
  res.json({ success: true, data: { delivered: merged.length } });
});

experimentsInternalRouter.post("/:id/hypothesis", async (req: Request<{ id: string }>, res: Response) => {
  const run = await experimentRepository.findById(req.params.id);
  if (!run) return notFound(res);
  const body = req.body as { epoch?: unknown; text?: unknown };
  if (typeof body.epoch !== "number" || typeof body.text !== "string") {
    res.status(400).json({ success: false, error: "invalid hypothesis body" });
    return;
  }
  // Only currentHypothesis — NEVER the run's epoch counter. The caller sends
  // its dispatch-time epoch, so a zombie session from a recovered epoch would
  // otherwise rewind run.epoch under the live one.
  await experimentRepository.update(run.id, { currentHypothesis: body.text.slice(0, 500) });
  res.json({ success: true });
});

experimentsInternalRouter.post("/:id/sandbox-note", async (req: Request<{ id: string }>, res: Response) => {
  const run = await experimentRepository.findById(req.params.id);
  if (!run) return notFound(res);
  const body = req.body as { note?: unknown };
  if (typeof body.note !== "string") {
    res.status(400).json({ success: false, error: "invalid sandbox-note body" });
    return;
  }
  await experimentRepository.update(run.id, { sandboxNote: body.note.slice(0, 2000) });
  res.json({ success: true });
});

experimentsInternalRouter.post("/:id/complete", async (req: Request<{ id: string }>, res: Response) => {
  const run = await experimentRepository.findById(req.params.id);
  if (!run) return notFound(res);
  const body = req.body as { report?: unknown };
  if (typeof body.report !== "string") {
    res.status(400).json({ success: false, error: "invalid complete body" });
    return;
  }
  // Only a live experiment can complete — a zombie session must not resurrect
  // an aborted run or overwrite an already-recorded final report.
  if (run.status !== "running" && run.status !== "finishing") {
    res.status(409).json({ success: false, error: `experiment is ${run.status}` });
    return;
  }
  const updated = await experimentRepository.update(run.id, { finalReport: body.report.slice(0, 20000), status: "done" });
  void postExperimentNotice(updated).catch((err) => {
    log.warn(`[experiment] complete notice failed id=${updated.id}: ${errMsg(err)}`);
  });
  res.json({ success: true });
});
