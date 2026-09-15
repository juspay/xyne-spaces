import { PrismaClient } from "@prisma/client";
import { errMsg } from "../lib/errors.js";
import { bankIdForAgent } from "xyne-claw-shared";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("memory-hygiene", createTraceId());

const DEFAULT_BANK_ALLOWLIST = ["xyne-xyne-spaces-architect"];
// The digital twin bank holds per-user personal memories partitioned by
// user:<id> tags. Cross-user duplicate collapse there would invalidate one
// user's memory as a "duplicate" of another's — never touch it, even if the
// env allowlist names it. Keyed on bank id (matches isDigitalTwinAgent in
// routes/memory.ts) so sanitized slug variants can't slip through.
const DIGITAL_TWIN_BANK = bankIdForAgent("digital-twin");
const DUPLICATE_THRESHOLD = 0.99;
const DEFAULT_MAX_COLLAPSED_PER_RUN = 2_000;
const MAX_ACTIVE_INGEST_OPERATIONS = 50;
const MAX_CONSECUTIVE_INVALIDATION_FAILURES = 25;

export interface DuplicateLinkRow {
  fromUnitId: string;
  toUnitId: string;
  linkType: string;
  weight: number;
  fromFactType: string;
  toFactType: string;
  fromCreatedAt: Date | string;
  toCreatedAt: Date | string;
}

export interface DuplicateCluster {
  canonical: string;
  dups: string[];
  size: number;
}

/**
 * Cluster near-identical facts using Hindsight's semantic-link graph.
 * The oldest fact is retained as canonical; an id tie-break keeps output
 * deterministic when two facts have the same creation timestamp.
 */
export function clusterDuplicateLinks(
  rows: DuplicateLinkRow[],
  threshold = DUPLICATE_THRESHOLD,
): DuplicateCluster[] {
  const parent = new Map<string, string>();
  const createdAt = new Map<string, number>();

  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = id;
    while (current !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  };

  for (const row of rows) {
    if (
      row.linkType !== "semantic" ||
      row.weight < threshold ||
      row.fromFactType === "observation" ||
      row.toFactType === "observation"
    ) {
      continue;
    }
    createdAt.set(row.fromUnitId, new Date(row.fromCreatedAt).getTime());
    createdAt.set(row.toUnitId, new Date(row.toCreatedAt).getTime());
    union(row.fromUnitId, row.toUnitId);
  }

  const membersByRoot = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const members = membersByRoot.get(root) ?? [];
    members.push(id);
    membersByRoot.set(root, members);
  }

  const clusters: DuplicateCluster[] = [];
  for (const members of membersByRoot.values()) {
    if (members.length < 2) continue;
    members.sort((left, right) => {
      const timeDelta = (createdAt.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (createdAt.get(right) ?? Number.MAX_SAFE_INTEGER);
      return timeDelta || left.localeCompare(right);
    });
    clusters.push({ canonical: members[0]!, dups: members.slice(1), size: members.length });
  }
  clusters.sort(
    (left, right) => right.size - left.size || left.canonical.localeCompare(right.canonical),
  );
  return clusters;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function configuredBanks(): string[] {
  const configured = process.env["MEMORY_HYGIENE_BANK_ALLOWLIST"];
  const banks =
    configured === undefined || configured.trim() === ""
      ? DEFAULT_BANK_ALLOWLIST
      : [...new Set(configured.split(",").map((bank) => bank.trim()).filter(Boolean))];
  return banks.filter((bank) => {
    if (bank !== DIGITAL_TWIN_BANK) return true;
    logger.warn("[memory-hygiene] Digital twin bank excluded from hygiene — refusing", { bank });
    return false;
  });
}

async function countActiveIngestOperations(db: PrismaClient, bank: string): Promise<number> {
  let rows: Array<{ count: bigint }>;
  try {
    rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT COUNT(*)::bigint AS count FROM async_operations WHERE bank_id = $1 AND status IN ('pending', 'processing')",
      bank,
    );
  } catch {
    // Hindsight schema versions have differed in this auxiliary table. Keep
    // the old safe global gate when bank_id is unavailable during a rollout.
    logger.warn("[memory-hygiene] Bank-scoped ingest count unavailable; falling back to global count", {
      bank,
    });
    rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT COUNT(*)::bigint AS count FROM async_operations WHERE status IN ('pending', 'processing')",
    );
  }
  return Number(rows[0]?.count ?? 0);
}

async function loadDuplicateLinks(db: PrismaClient, bank: string): Promise<DuplicateLinkRow[]> {
  return db.$queryRawUnsafe<DuplicateLinkRow[]>(
    `SELECT
       ml.from_unit_id::text AS "fromUnitId",
       ml.to_unit_id::text AS "toUnitId",
       ml.link_type AS "linkType",
       ml.weight::double precision AS weight,
       ma.fact_type AS "fromFactType",
       mb.fact_type AS "toFactType",
       ma.created_at AS "fromCreatedAt",
       mb.created_at AS "toCreatedAt"
     FROM memory_links ml
     JOIN memory_units ma ON ma.id = ml.from_unit_id
     JOIN memory_units mb ON mb.id = ml.to_unit_id
     WHERE ml.bank_id = $1
       AND ml.link_type = 'semantic'
       AND ml.weight >= $2::double precision
       AND ma.fact_type <> 'observation'
       AND mb.fact_type <> 'observation'`,
    bank,
    DUPLICATE_THRESHOLD,
  );
}

async function invalidateDuplicate(
  baseUrl: string,
  bank: string,
  cluster: DuplicateCluster,
  duplicateId: string,
): Promise<void> {
  const tenant = process.env["HINDSIGHT_TENANT"] ?? "default";
  const apiKey = process.env["HINDSIGHT_API_KEY"] ?? "";
  const url = `${baseUrl}/v1/${encodeURIComponent(tenant)}/banks/${encodeURIComponent(bank)}/memories/${encodeURIComponent(duplicateId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      state: "invalidated",
      reason: `collapsed duplicate of ${cluster.canonical} (cluster size ${cluster.size}, threshold ${DUPLICATE_THRESHOLD})`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Hindsight invalidate ${response.status}: ${body.slice(0, 200)}`);
  }
}

export async function collapseDuplicates(
  db: PrismaClient,
  baseUrl: string,
  bank: string,
  remainingRunCapacity: number,
): Promise<{ collapsed: number; attempted: number }> {
  const activeOperations = await countActiveIngestOperations(db, bank);
  if (activeOperations > MAX_ACTIVE_INGEST_OPERATIONS) {
    logger.warn("[memory-hygiene] Duplicate collapse skipped — large ingest is active", {
      bank,
      activeOperations,
      maximumAllowed: MAX_ACTIVE_INGEST_OPERATIONS,
    });
    return { collapsed: 0, attempted: 0 };
  }
  if (remainingRunCapacity <= 0) {
    logger.warn("[memory-hygiene] Duplicate collapse skipped — nightly run cap reached", { bank });
    return { collapsed: 0, attempted: 0 };
  }

  const clusters = clusterDuplicateLinks(await loadDuplicateLinks(db, bank));
  let collapsed = 0;
  let attempted = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let aborted = false;
  collapseLoop: for (const cluster of clusters) {
    for (const duplicateId of cluster.dups) {
      if (attempted >= remainingRunCapacity) break;
      attempted += 1;
      try {
        await invalidateDuplicate(baseUrl, bank, cluster, duplicateId);
        collapsed += 1;
        consecutiveFailures = 0;
      } catch (err) {
        failed += 1;
        consecutiveFailures += 1;
        if (failed <= 3) {
          logger.error("[memory-hygiene] Duplicate invalidation failed", {
            bank,
            duplicateId,
            canonical: cluster.canonical,
            err: errMsg(err),
          });
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_INVALIDATION_FAILURES) {
          aborted = true;
          logger.error("[memory-hygiene] Aborting duplicate collapse after consecutive invalidation failures", {
            bank,
            consecutiveFailures,
            attempted,
          });
          break collapseLoop;
        }
      }
    }
    if (attempted >= remainingRunCapacity) break;
  }
  const availableDuplicates = clusters.reduce((total, cluster) => total + cluster.dups.length, 0);
  logger.info("[memory-hygiene] Duplicate collapse complete", {
    bank,
    threshold: DUPLICATE_THRESHOLD,
    clusters: clusters.length,
    attempted,
    collapsed,
    failed,
    aborted,
    capped: availableDuplicates > attempted,
  });
  return { collapsed, attempted };
}

async function runHindsightRetention(bank: string): Promise<void> {
  // TODO(hindsight-0.8.4): No Hindsight retention endpoint is used anywhere
  // in this repository. Wire the documented 0.8.4 route here once its exact
  // contract is established; do not guess a production mutation endpoint.
  logger.warn(
    "[memory-hygiene] Hindsight retention step is not wired — endpoint contract TODO",
    { bank },
  );
}

async function loadNoveltyReport(
  db: PrismaClient,
  bank: string,
): Promise<{ totalFacts: number; added24h: number }> {
  const rows = await db.$queryRawUnsafe<Array<{ totalFacts: bigint; added24h: bigint }>>(
    `SELECT
       COUNT(*) FILTER (WHERE fact_type <> 'observation')::bigint AS "totalFacts",
       COUNT(*) FILTER (
         WHERE fact_type <> 'observation' AND created_at >= NOW() - INTERVAL '24 hours'
       )::bigint AS "added24h"
     FROM memory_units
     WHERE bank_id = $1`,
    bank,
  );
  return {
    totalFacts: Number(rows[0]?.totalFacts ?? 0),
    added24h: Number(rows[0]?.added24h ?? 0),
  };
}

/** Run the Hindsight-specific hygiene pass. Banks and all steps are sequential. */
export async function runNightlyMemoryHygiene(): Promise<void> {
  const baseUrl = (process.env["HINDSIGHT_URL"] ?? "").replace(/\/+$/, "");
  if (!baseUrl) {
    logger.warn("[memory-hygiene] Nightly hygiene skipped — HINDSIGHT_URL is unset");
    return;
  }

  // In Kubernetes HINDSIGHT_DATABASE_URL maps to secret
  // hindsight-db-url, key DATABASE_URL. It is intentionally optional.
  const databaseUrl = process.env["HINDSIGHT_DATABASE_URL"];
  const db = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : undefined;
  const maxPerRun = positiveInteger(
    process.env["COLLAPSE_MAX_PER_RUN"],
    DEFAULT_MAX_COLLAPSED_PER_RUN,
  );
  let attemptedAcrossRun = 0;

  try {
    for (const bank of configuredBanks()) {
      let collapsedThisRun = 0;

      try {
        if (!db) {
          logger.warn(
            "[memory-hygiene] Duplicate collapse skipped — HINDSIGHT_DATABASE_URL is unset",
            { bank },
          );
        } else {
          const collapse = await collapseDuplicates(
            db,
            baseUrl,
            bank,
            maxPerRun - attemptedAcrossRun,
          );
          collapsedThisRun = collapse.collapsed;
          attemptedAcrossRun += collapse.attempted;
        }
      } catch (err) {
        logger.error("[memory-hygiene] Duplicate collapse failed", {
          bank,
          err: errMsg(err),
        });
      }

      try {
        await runHindsightRetention(bank);
      } catch (err) {
        logger.error("[memory-hygiene] Retention step failed", {
          bank,
          err: errMsg(err),
        });
      }

      try {
        if (!db) {
          logger.warn(
            "[memory-hygiene] Novelty report unavailable — HINDSIGHT_DATABASE_URL is unset",
            { bank },
          );
          logger.info("[memory-hygiene] novelty-rate", {
            bank,
            totalFacts: null,
            added24h: null,
            collapsedThisRun,
          });
        } else {
          const novelty = await loadNoveltyReport(db, bank);
          logger.info("[memory-hygiene] novelty-rate", { bank, ...novelty, collapsedThisRun });
        }
      } catch (err) {
        logger.error("[memory-hygiene] Novelty report failed", {
          bank,
          err: errMsg(err),
        });
      }
    }
  } finally {
    await db?.$disconnect();
  }
}
