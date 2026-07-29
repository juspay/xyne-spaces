/**
 * Search Evals — full per-query run export as a real .xlsx workbook (not
 * CSV): every query's every fetched result (up to 20, same set the debug
 * dialog shows), with the same match-features breakdown as
 * MatchFeaturesTable (SearchEvalsPageV3.tsx) plus a Content column and a
 * Relevance column, all in one downloadable file instead of having to click
 * into each query's debug dialog one at a time.
 */
import ExcelJS from "exceljs";
import { Router, type Request, type Response } from "express";
import { searchEvalRepository, toMetricsSummary, type SearchEvalTopResult } from "../../repositories/index.js";

import { createLogger } from "../../logger.js";
const log = createLogger("search-evals/export");

const router = Router();

/** Whatever the active rank profile's `match-features {}` block attached to
 *  this hit (bm25(text), vector_score, combined_nativeRank, etc.) — see
 *  transformHit()'s debugInfo passthrough in vespa-direct.ts. */
function matchFeaturesOf(r: SearchEvalTopResult): Record<string, unknown> | null {
  const raw = r.raw as { debugInfo?: { matchfeatures?: Record<string, unknown> } } | null | undefined;
  return raw?.debugInfo?.matchfeatures ?? null;
}

/** Context for a message result, title for everything else (file/attachment/
 *  mail results have their `context` stripped at write time — see
 *  TYPES_WITHOUT_STORED_CONTEXT in search-eval-run-worker.ts — since their
 *  title (fileName / email subject) already identifies them). */
function contentOf(r: SearchEvalTopResult): string {
  const raw = r.raw as { context?: unknown; title?: unknown } | null | undefined;
  const context = typeof raw?.context === "string" ? raw.context : "";
  if (context) return context;
  return typeof raw?.title === "string" ? raw.title : "";
}

function typeOf(r: SearchEvalTopResult): string {
  const raw = r.raw as { type?: unknown } | null | undefined;
  return typeof raw?.type === "string" ? raw.type : "";
}

function titleOf(r: SearchEvalTopResult): string {
  const raw = r.raw as { title?: unknown } | null | undefined;
  return typeof raw?.title === "string" ? raw.title : "";
}

// GET /search-evals/runs/:id/export — full per-query result data as .xlsx
router.get("/runs/:id/export", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const run = await searchEvalRepository.getRunWithResults(req.params.id);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }

    const resultsByQueryId = new Map(run.results.map((r) => [r.queryId, r]));
    const rows = run.sheet.queries.map((q) => {
      const result = resultsByQueryId.get(q.id);
      return {
        query: q.query,
        goldAnswer: q.goldAnswer,
        goldId: q.goldId,
        hit: result?.hit ?? null,
        rank: result?.rank ?? null,
        topResults: (result?.topResults as unknown as SearchEvalTopResult[] | null) ?? [],
      };
    });

    // Union of match-feature keys across every result in the run — different
    // entity types (an "All types" run) or rank profiles can declare
    // different feature sets, so no single row has them all.
    const featureColumns = Array.from(
      new Set(
        rows.flatMap((r) => r.topResults.flatMap((tr) => Object.keys(matchFeaturesOf(tr) ?? {}))),
      ),
    ).sort();

    const wb = new ExcelJS.Workbook();
    wb.creator = "Xyne Search Evals";
    wb.created = new Date();

    // ── Summary sheet ──────────────────────────────────────────────────
    const summarySheet = wb.addWorksheet("Summary");
    const summary = toMetricsSummary(
      {
        queriesScored: run.queriesScored,
        top1Count: run.top1Count,
        top1Pct: run.top1Pct,
        top3Count: run.top3Count,
        top3Pct: run.top3Pct,
        top10Count: run.top10Count,
        top10Pct: run.top10Pct,
        mrr: run.mrr,
      },
      run.sheet.queries.length,
    );
    const rankProfileInputs = run.rankProfileInputs as Record<string, number> | null;
    summarySheet.addRows([
      ["Eval name", run.sheet.name],
      ["Goal", run.sheet.description ?? ""],
      ["Run ID", run.id],
      ["Permission mode", run.permissionMode],
      ["Entity type", run.queryType.length > 0 ? run.queryType.join(", ") : "All types"],
      ["Rank profile", run.rankProfile ?? "default_native"],
      ...(rankProfileInputs && Object.keys(rankProfileInputs).length > 0
        ? [["Rank profile inputs", Object.entries(rankProfileInputs).map(([k, v]) => `${k}=${v}`).join(", ")]]
        : []),
      ["As of", run.asOfTimestamp ? run.asOfTimestamp.toISOString() : ""],
      ["Started at", run.startedAt.toISOString()],
      ["Completed at", run.completedAt ? run.completedAt.toISOString() : ""],
      ["Status", run.status],
      [],
      ["Queries scored", summary.queriesScored, "of", summary.queriesTotal],
      ["Top 1", summary.top1.count, summary.top1.pct != null ? `${(summary.top1.pct * 100).toFixed(1)}%` : ""],
      ["Top 3", summary.top3.count, summary.top3.pct != null ? `${(summary.top3.pct * 100).toFixed(1)}%` : ""],
      ["Top 10", summary.top10.count, summary.top10.pct != null ? `${(summary.top10.pct * 100).toFixed(1)}%` : ""],
      ["MRR", summary.mrr ?? ""],
    ]);
    summarySheet.getColumn(1).width = 20;
    summarySheet.getColumn(2).width = 50;
    summarySheet.getColumn(1).font = { bold: true };

    // ── Results sheet — one row per (query × result), incl. match features ──
    const resultsSheet = wb.addWorksheet("Results");
    const baseHeader = [
      "Query", "Gold ID", "Gold Answer", "Hit", "Gold Rank",
      "Result Rank", "Is Gold", "Result ID", "Ticket ID", "Type", "Title", "Content", "Relevance",
    ];
    resultsSheet.columns = [...baseHeader, ...featureColumns].map((h) => ({ header: h, key: h, width: 18 }));
    resultsSheet.getRow(1).font = { bold: true };
    resultsSheet.getColumn("Query").width = 40;
    resultsSheet.getColumn("Gold Answer").width = 40;
    resultsSheet.getColumn("Content").width = 60;

    for (const row of rows) {
      if (row.topResults.length === 0) {
        resultsSheet.addRow({
          Query: row.query, "Gold ID": row.goldId, "Gold Answer": row.goldAnswer ?? "",
          Hit: row.hit === true ? "Yes" : row.hit === false ? "No" : "",
          "Gold Rank": row.rank ?? "",
        });
        continue;
      }
      row.topResults.forEach((tr, idx) => {
        const isGold = (tr.id && tr.id === row.goldId) || (tr.xyneId && tr.xyneId === row.goldId);
        const features = matchFeaturesOf(tr) ?? {};
        const record: Record<string, unknown> = {
          Query: row.query,
          "Gold ID": row.goldId,
          "Gold Answer": row.goldAnswer ?? "",
          Hit: row.hit === true ? "Yes" : row.hit === false ? "No" : "",
          "Gold Rank": row.rank ?? "",
          "Result Rank": idx + 1,
          "Is Gold": isGold ? "★" : "",
          "Result ID": tr.id ?? "",
          // Human-facing ticket number (e.g. "XYNE-13292") — only set for
          // ticket results; "Result ID" above is the ticket's internal docId,
          // not what someone reviewing search results would recognize.
          "Ticket ID": tr.xyneId ?? "",
          Type: typeOf(tr),
          Title: titleOf(tr),
          Content: contentOf(tr),
          Relevance: tr.relevanceScore ?? "",
        };
        for (const col of featureColumns) {
          const v = features[col];
          record[col] = typeof v === "number" ? v : v !== undefined ? String(v) : "";
        }
        const excelRow = resultsSheet.addRow(record);
        if (isGold) {
          excelRow.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4EA" } };
          });
        }
      });
    }
    resultsSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: baseHeader.length + featureColumns.length } };

    const safeName = run.sheet.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "search-eval";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-run-${run.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    log.error("[search-evals] export error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Failed to export run" });
    }
  }
});

export { router as searchEvalExportRouter };
