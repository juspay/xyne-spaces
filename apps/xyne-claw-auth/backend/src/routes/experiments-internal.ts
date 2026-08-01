import { Router, type Request, type Response } from "express";
import { experimentRepository } from "../repositories/index.js";
import { buildLedgerMarkdown } from "../lib/experiment.js";

export const experimentsInternalRouter = Router();

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
  // Length caps: findings feed straight into every later epoch's task prompt
  // (buildLedgerMarkdown), so uncapped text compounds across an 8h run.
  const row = await experimentRepository.upsertFindingByTitle({
    experimentId: run.id,
    epoch: body.epoch,
    status: body.status,
    title: body.title.slice(0, 200),
    hypothesis: body.hypothesis.slice(0, 2000),
    note: typeof body.note === "string" ? body.note.slice(0, 2000) : null,
    proofArtifactPath: typeof body.proofArtifactPath === "string" ? body.proofArtifactPath.slice(0, 500) : null,
  });
  res.json({ success: true, data: { id: row.id } });
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
  await experimentRepository.update(run.id, { finalReport: body.report.slice(0, 20000), status: "done" });
  res.json({ success: true });
});

