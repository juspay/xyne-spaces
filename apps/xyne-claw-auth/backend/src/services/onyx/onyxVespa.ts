/**
 * Direct Vespa lookup for the Onyx harness — **gold-material fetch only**.
 *
 * The corpus lives in the eval Vespa cluster under ONYX_EVAL_WORKSPACE_ID
 * with NO Spaces psql records (the agent could not find these docs through
 * psql-backed tools even if it tried). Retrieval itself is NEVER done here —
 * that's the ask-ai agent's measured behavior via the spaces-search tool.
 *
 * The only call this module exposes, `fetchOnyxDocsByIds`, is harness infra
 * for §5.3 corrected-gold regeneration: when a 3-judge panel PROMOTES a gold
 * doc the retriever missed (or an anti-hallucination fact needs source text),
 * we need the doc's content regardless of what the agent surfaced. That fetch
 * must not touch the measured pipeline — the agent's view of the world stays
 * bounded by the tool, only the grader reads the answer key.
 */
import { CONFIG } from "../../config.js";
import { callVespa } from "../../mcp/servers/vespa-direct.js";

import { createLogger } from "../../logger.js";
const log = createLogger("onyx-vespa");

/** The schemas the benchmark ingest writes to (same .sd as prod's). */
const RETRIEVAL_SCHEMAS = "chat_message, file, mail, ticket";

export interface OnyxRetrievedDoc {
  /** The synthetic id Vespa stores (enterprise-rag-bench-<source>-<hash>). */
  docId: string;
  title: string;
  content: string;
  rank: number;
  score: number;
}

function escWs(id: string): string {
  return id.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function extractTitle(fields: Record<string, unknown>): string {
  return String(
    fields["fileName"] ?? fields["subject"] ?? fields["title"] ?? fields["name"]
      ?? fields["messageChannelName"] ?? fields["username"] ?? fields["docId"] ?? "Untitled",
  );
}

function extractContent(fields: Record<string, unknown>): string {
  const chunks = Array.isArray(fields["chunks"]) ? (fields["chunks"] as string[]) : [];
  return (
    chunks.join("\n")
    || String(fields["text"] ?? fields["description"] ?? fields["initialMessage"] ?? fields["subject"] ?? fields["fileName"] ?? "")
  );
}

function parseHits(raw: Record<string, unknown>): OnyxRetrievedDoc[] {
  const root = (raw["root"] ?? {}) as Record<string, unknown>;
  const children = Array.isArray(root["children"]) ? (root["children"] as Record<string, unknown>[]) : [];
  return children.map((hit, i) => {
    const fields = (hit["fields"] ?? {}) as Record<string, unknown>;
    return {
      docId: String(fields["docId"] ?? ""),
      title: extractTitle(fields),
      content: extractContent(fields),
      rank: i + 1,
      score: typeof hit["relevance"] === "number" ? hit["relevance"] : 0,
    };
  }).filter((d) => d.docId.length > 0);
}

/**
 * Fetch the specific docs the 3-judge panel promoted to "required" but which
 * weren't in this run's retrieved set — needed so paper §5.3 gold regeneration
 * has the corrected gold's CONTENT, not just its ids. This is the sole
 * purpose of direct Vespa access in the harness: gold material for the grader,
 * never the agent's tool path.
 */
export async function fetchOnyxDocsByIds(docIds: string[], workspaceId: string): Promise<OnyxRetrievedDoc[]> {
  if (docIds.length === 0) return [];
  const clauses = docIds.map((id) => `docId contains "${escWs(id)}"`).join(" or ");
  const yql = `select * from ${RETRIEVAL_SCHEMAS} where (${clauses}) and (workspaceId contains "${escWs(workspaceId)}");`;
  log.info(`[onyx-vespa] fetch ${docIds.length} gold docs`);
  const raw = await callVespa(
    { yql, hits: docIds.length, timeout: "30s", "ranking.profile": "unranked" },
    CONFIG.onyxVespaEndpoint,
  );
  return parseHits(raw);
}
