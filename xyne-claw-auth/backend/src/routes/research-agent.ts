import { Router, type Response } from "express";
import { CONFIG } from "../config.js";

import { createLogger } from "../logger.js";
const log = createLogger("research-agent");

const router = Router();

type ResearchAgentOption = { id: string; name: string };

function getName(row: Record<string, unknown>): string | undefined {
  const name = row["name"] ?? row["repo_name"] ?? row["repository_name"] ?? row["display_name"] ?? row["title"];
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function normalizeOptions(raw: unknown): ResearchAgentOption[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown[] })?.data)
      ? (raw as { data: unknown[] }).data
      : Array.isArray((raw as { items?: unknown[] })?.items)
        ? (raw as { items: unknown[] }).items
        : [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = record["id"];
    if (typeof id !== "string" && typeof id !== "number") return [];
    const idText = String(id).trim();
    if (!idText) return [];
    return [{ id: idText, name: getName(record) ?? idText }];
  });
}

async function proxyOptions(path: string, res: Response): Promise<void> {
  try {
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (CONFIG.researchAgentApiKey) {
      headers["Authorization"] = `Bearer ${CONFIG.researchAgentApiKey}`;
    }

    const response = await fetch(`${CONFIG.researchAgentBaseUrl}${path}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      res.status(response.status).json({ success: false, error: text || `Research Agent returned ${response.status}` });
      return;
    }

    const data = await response.json();
    res.json({ success: true, data: normalizeOptions(data) });
  } catch (err) {
    log.error("[research-agent] option fetch failed:", err);
    res.status(500).json({ success: false, error: "Failed to fetch Research Agent options" });
  }
}

router.get("/products", (_req, res) => { void proxyOptions("/api/crud/products", res); });
router.get("/repositories", (_req, res) => { void proxyOptions("/api/crud/repositories", res); });

export { router as researchAgentRouter };
