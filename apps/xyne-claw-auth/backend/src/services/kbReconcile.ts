/**
 * People-KB reconcile — reads the KB back and corrects it.
 *
 * The nightly merge writes from one day of findings, which is the right amount
 * of evidence for a fact and far too little to judge a person. It names someone
 * an authority off a single thread because a single thread is all it can see.
 * This pass is what makes that acceptable: write eagerly, correct later.
 *
 * READS PAGES, NOT FINDINGS. The merge already put the evidence on the page —
 * a permalink per claim, and first/last/seen markers saying how often something
 * was confirmed. So the KB describes itself, and reconcile needs no second
 * source. Its input is bounded by the size of the tree rather than by months of
 * findings volume.
 *
 * What makes correction possible at all: pages cannot be DELETED (itemIds are
 * embedded in saved links) but their content can be rewritten. That is the whole
 * opening — a wrong verdict is fixable, a wrongly-created folder is not, which
 * is why folding a duplicate means rewriting the loser into a redirect stub
 * rather than removing it.
 *
 * ONE ENTITY PER SESSION, SEQUENTIAL. people/<person>.md is shared across
 * entities, so concurrent sessions would overwrite each other there — KbFs has
 * no compare-and-swap.
 *
 * Manual only. There is no cron: this rewrites pages wholesale, and a bad fold
 * cannot be undone, so a human decides when it runs.
 */
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { attachKbGrantsToConfig } from "../lib/spaces-kb.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";

const logger = createLogger("kb-reconcile");

/** Fallback when a project does not name its own reconcile agent. */
const DEFAULT_RECONCILE_AGENT = process.env["KB_RECONCILE_AGENT_SLUG"] ?? "kb-reconcile";

/** How long one entity's session may run before it is treated as stuck. */
const SESSION_WAIT_MS = Number(process.env["KB_RECONCILE_SESSION_WAIT_MS"] ?? 15 * 60 * 1000);

/** The KB roots an entity can live under. Anything else is not an entity folder. */
const ENTITY_ROOTS = ["services", "surfaces", "tools"];

/**
 * Entities per run.
 *
 * Sessions are sequential and take minutes, so an unbounded pass over a real KB
 * is hours: 213 entities measured locally would be about seven. A run has to
 * finish while someone is still watching it, so it takes a slice and the next
 * press continues.
 */
const MAX_ENTITIES_PER_RUN = Number(process.env["KB_RECONCILE_MAX_ENTITIES"] ?? 25);

interface Entity {
  root: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/**
 * Every entity folder in the project, from the KB listing.
 *
 * Same call knownEntities() makes in kbExtractDaily, read for a different
 * purpose: there it is a naming vocabulary, here it is the work list. Paths are
 * projects/<CODE>/<root>/<entity>/<file>.md, so the entity is segment 3.
 *
 * Derived from the tree rather than from findings on purpose — a duplicate
 * folder may have no recent findings at all, and folding it is exactly what this
 * pass exists for.
 */
async function listEntities(collectionId: string, userId: string): Promise<Entity[]> {
  const params = new URLSearchParams({ collectionId, userId });
  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/kb/list?${params}`, {
    headers: {
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey, "x-user-id": userId } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`kb list failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as { data?: { paths?: string[] } };
  const seen = new Map<string, Entity>();

  for (const path of body.data?.paths ?? []) {
    const parts = path.split("/");
    // projects / <CODE> / <root> / <entity> [ / <file>.md ]
    // Folder paths are listed alongside file paths, so four segments is enough —
    // requiring the file would miss an entity whose folder came back on its own.
    if (parts.length < 4) continue;
    const root = parts[2]!;
    const name = parts[3]!;
    if (!ENTITY_ROOTS.includes(root)) continue;
    seen.set(`${root}/${name}`, { root, name });
  }

  return [...seen.values()].sort((a, b) =>
    a.root === b.root ? a.name.localeCompare(b.name) : a.root.localeCompare(b.root),
  );
}

/**
 * The slice to reconcile this run: least recently done first.
 *
 * Derived from kb_runs rather than a watermark column, because a position in an
 * alphabetical list stops meaning anything the moment an entity is added ahead
 * of it. Ordering by when each was last reconciled — never-reconciled first —
 * round-robins the whole KB across successive runs and needs no new state.
 */
async function selectSlice(projectCode: string, entities: Entity[]): Promise<Entity[]> {
  const previous = await prisma.kbRun.findMany({
    where: { kind: "RECONCILE", projectCode, status: "COMPLETED" },
    select: { subject: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });

  const lastDone = new Map<string, number>();
  for (const run of previous) {
    // Ordered newest first, so the first sighting of a subject is its latest run.
    if (!lastDone.has(run.subject)) lastDone.set(run.subject, run.startedAt.getTime());
  }

  return [...entities]
    .sort((a, b) => {
      const ka = lastDone.get(`${a.root}/${a.name}`) ?? 0;
      const kb = lastDone.get(`${b.root}/${b.name}`) ?? 0;
      return ka - kb;
    })
    .slice(0, MAX_ENTITIES_PER_RUN);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

interface ReconcileProject {
  projectId: string;
  projectCode: string;
  workspaceId: string;
  agentSlug: string;
}

/** The instruction for one entity folder, including what it could be folded into. */
function entityTask(project: ReconcileProject, entity: Entity, siblings: Entity[]): string {
  // Judging whether this entity is a duplicate needs to know what else exists
  // under the same root, and the agent would otherwise ls its way to the same
  // answer.
  const siblingNames = siblings
    .filter((s) => s.root === entity.root && s.name !== entity.name)
    .map((s) => s.name);

  return (
    `Reconcile projects/${project.projectCode}/${entity.root}/${entity.name}/.\n\n` +
    `Read every page in that folder, and the person pages it references, then ` +
    `correct them against the evidence recorded on them.\n\n` +
    (siblingNames.length > 0
      ? `Other entities under ${entity.root}/: ${siblingNames.join(", ")}\n` +
        `If this entity is the same thing as one of those, or a component of one, ` +
        `fold it into that one and leave this page as a redirect stub.\n\n`
      : "") +
    `Change nothing that the pages already support. A run that rewrites pages ` +
    `without new reason to is worse than one that does nothing.`
  );
}

/**
 * The instruction for the project overview.
 *
 * Runs after every entity, so the tree it summarises is the corrected one — an
 * overview written before a fold would name an entity that no longer exists.
 */
function overviewTask(project: ReconcileProject, entities: Entity[]): string {
  const tree = entities.map((e) => `${e.root}/${e.name}`).join(", ");

  return (
    `Reconcile projects/${project.projectCode}/overview.md.\n\n` +
    `The entities now in this KB: ${tree || "none yet"}\n\n` +
    `Read the overview and check it against that list and against the entity pages ` +
    `themselves. Remove anything naming an entity that no longer exists or was folded ` +
    `away, and anything the pages no longer support. Keep it inside its budget — if ` +
    `something belongs there and the page is full, drop the weaker line.\n\n` +
    `Leave it alone if it is already right. This page is read first by everyone, so ` +
    `churning it costs more than it gains.`
  );
}

/** Runs one reconcile session, recording the attempt and what the agent reported. */
async function reconcileOne(
  project: ReconcileProject,
  subject: string,
  task: string,
): Promise<boolean> {
  const run = await prisma.kbRun.create({
    data: {
      kind: "RECONCILE",
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      projectCode: project.projectCode,
      subject,
    },
  });

  try {
    const agent = await prisma.agent.findFirst({ where: { slug: project.agentSlug } });
    if (!agent) throw new Error(`agent ${project.agentSlug} not found`);

    const agentConfig = await attachKbGrantsToConfig(
      agent.config as Record<string, unknown>,
      agent.id,
      prisma,
    );

    // Report accumulates from the stream so the run row can say what changed,
    // rather than only whether it finished.
    let report = "";

    const stream = await consumeClawStream({
      url: `${CONFIG.internalUrl}/claw/api/v1/internal/run`,
      s2sKey: CONFIG.xyneClawS2sKey,
      signal: AbortSignal.timeout(SESSION_WAIT_MS),
      handlers: {
        onTextDelta: (_sessionId, delta) => {
          report += delta;
        },
        onError: (sessionId, error) => {
          logger.error("[kb-reconcile] session error", { sessionId: sessionId ?? "?", error });
        },
      },
      body: {
        userId: agent.ownerUserId,
        agentSlug: project.agentSlug,
        systemPrompt: agent.systemPrompt,
        task,
        // Unique per attempt. A deterministic id resumes the previous session,
        // which then reads its own transcript saying the work is already done.
        conversationId: `kb-reconcile-${project.projectCode}-${run.id}`,
        agentConfig,
      },
    });

    if (stream.result?.status !== "completed") {
      throw new Error(
        `reconcile session ended as ${stream.result?.status ?? stream.errorReason ?? "no done frame"}`,
      );
    }

    await prisma.kbRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", summary: report.slice(0, 20_000), finishedAt: new Date() },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.kbRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    logger.error("[kb-reconcile] session failed", {
      code: project.projectCode,
      subject,
      err: message,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Reconciles every entity in one project, one at a time.
 *
 * A failed entity does not stop the rest: the pages it left behind are no worse
 * than before the run, and the remaining entities are still worth correcting.
 */
export async function runKbReconcile(projectCode: string, onlyEntity?: string): Promise<void> {
  const project = await prisma.kbProject.findUnique({ where: { projectCode } });
  if (!project || !project.enabled) {
    logger.info("[kb-reconcile] no enabled project", { code: projectCode });
    return;
  }

  const userId = project.enabledBy ?? "";
  if (!userId) {
    logger.error("[kb-reconcile] project has no enabledBy — cannot read the KB", { code: projectCode });
    return;
  }

  const entities = await listEntities(project.collectionId, userId);
  if (entities.length === 0) {
    logger.info("[kb-reconcile] no entities in the KB yet", { code: projectCode });
    return;
  }

  const target: ReconcileProject = {
    projectId: project.projectId,
    projectCode: project.projectCode,
    workspaceId: project.workspaceId,
    agentSlug: project.reconcileAgentSlug ?? DEFAULT_RECONCILE_AGENT,
  };

  const slice = onlyEntity
    ? entities.filter((e) => `${e.root}/${e.name}` === onlyEntity)
    : await selectSlice(projectCode, entities);

  if (slice.length === 0) {
    logger.warn("[kb-reconcile] nothing to do", { code: projectCode, requested: onlyEntity ?? "(slice)" });
    return;
  }

  // Said out loud, because a capped run that reports success looks identical to
  // one that covered everything.
  logger.info("[kb-reconcile] starting", {
    code: projectCode,
    reconciling: String(slice.length),
    ofTotal: String(entities.length),
    ...(slice.length < entities.length
      ? { deferred: `${entities.length - slice.length} entities left for the next run` }
      : {}),
  });

  let failed = 0;
  for (const entity of slice) {
    const ok = await reconcileOne(
      target,
      `${entity.root}/${entity.name}`,
      entityTask(target, entity, entities),
    );
    if (!ok) failed += 1;
  }

  // Last, deliberately. The overview summarises the tree, so it has to see the
  // tree as the entity passes left it — written earlier it would describe folders
  // that were folded away minutes later. Skipped for a single-entity run, which
  // is a targeted fix rather than a sweep.
  if (!onlyEntity && !(await reconcileOne(target, "overview.md", overviewTask(target, entities)))) {
    failed += 1;
  }

  logger.info("[kb-reconcile] finished", {
    code: projectCode,
    reconciled: String(slice.length),
    ofTotal: String(entities.length),
    failed: String(failed),
  });
}
