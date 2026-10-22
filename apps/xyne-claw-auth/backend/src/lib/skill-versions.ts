/**
 * The registry's skill adapter. Every writer calls commitSkillVersion() and the one loader,
 * resolveRunSkills(), serves only an approved hash: in enforce mode the last approved bundle
 * or nothing, in shadow mode the current bundle with a record of what enforce would have done.
 * A bundle (name, description, SKILL.md and files) is hashed as one canonical string and stored
 * by hash, so an older approved version can still be served or rolled back to.
 */
import { componentMode, planChecks, sha256Hex, type CheckPlan, type Verdict } from "xyne-claw-shared/governance";
import { governancePrisma, prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { queueGovernanceEvent } from "./governance-audit.js";
import { commitStaticContentVersion, setStaticContentApproval, type ApprovedVia, type WrittenBy } from "./governance-registry.js";

const log = createLogger("skill-versions");
const storage = async () => (await import("../services/storageService.js")).gcsService;

export interface SkillBundleFile {
  relativePath: string;
  content: string;
  contentType?: string | null | undefined;
}
export interface SkillBundle {
  name: string;
  description: string;
  content: string;
  files: SkillBundleFile[];
}
export interface SkillRow {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  description: string;
  content: string;
  scope: string;
  files?: SkillBundleFile[] | undefined;
}
export interface SkillWrite {
  writtenBy: WrittenBy;
  /** The person writing, or the person whose approval carried an agent's write. */
  userId?: string | undefined;
  agentId?: string | undefined;
  conversationId?: string | undefined;
  /** How this write approves itself when the checks allow it: the owner's own edit, an admin's, CI. */
  approvedVia?: ApprovedVia | undefined;
  /** Content already in use before the registry: its first version is approved as the baseline. */
  baselineIfFirst?: boolean | undefined;
}
export interface SkillVersionOutcome {
  versionId: string;
  sha256: string;
  status: string;
  created: boolean;
  parserVerdict: Verdict | undefined;
}
export interface RunSkill {
  slug: string;
  name: string;
  description: string;
  content: string;
  files?: SkillBundleFile[] | undefined;
  versionId?: string | undefined;
  contentSha256?: string | undefined;
}
export interface ManifestEntry {
  skillId: string;
  slug: string;
  sha256: string;
  versionId: string | null;
  /** approved | pending | rejected | held | revoked | unregistered, plus what shadow would have done. */
  status: string;
  served: "current" | "previous" | "none";
}

export const subjectKeyOf = (skillId: string): string => `skill:${skillId}`;
const bundlePath = (orgId: string, sha256: string): string => `governance/skill-bundles/${orgId}/${sha256}.json`;
const EXECUTABLE = /(^|\/)scripts\/|\.(sh|bash|zsh|py|rb|pl|php|js|mjs|cjs|ts|ps1|bat|cmd|exe|bin|wasm|jar|so|dylib|dll|zip|tar|gz|tgz|7z)$/i;
const BINARY = /^(image|audio|video)\/|pdf|octet-stream|zip|msword|officedocument/i;
const isText = (f: SkillBundleFile): boolean => !(f.contentType && BINARY.test(f.contentType)) && !/\.(png|jpe?g|gif|webp|pdf|docx?|xlsx?|pptx?|zip|gz|tgz|exe|bin|wasm)$/i.test(f.relativePath);

/** SHA-256 over one canonical string: name, description, SKILL.md (LF) and the sorted (path, executable, sha256) list. */
export function hashSkillBundle(bundle: SkillBundle): { sha256: string; executable: boolean; files: Array<[string, number, string]> } {
  const files = bundle.files
    .map((f): [string, number, string] => [f.relativePath, EXECUTABLE.test(f.relativePath) ? 1 : 0, sha256Hex(f.content)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonical = JSON.stringify([bundle.name, bundle.description, bundle.content.replace(/\r\n/g, "\n"), files]);
  return { sha256: sha256Hex(canonical), executable: files.some((f) => f[1] === 1), files };
}

/** What the parser reads: SKILL.md and every text file, each under its path. */
export function skillScanText(bundle: SkillBundle): string {
  return [bundle.content, ...bundle.files.filter(isText).map((f) => `\n\n### ${f.relativePath}\n${f.content}`)].join("");
}

export function decideSkillApproval(plan: CheckPlan, parserVerdict: Verdict | undefined, executable: boolean, actor: ApprovedVia | undefined): { status: "approved" | "pending" | "rejected"; via?: ApprovedVia; reason: string } {
  if (parserVerdict === "injection") return { status: "rejected", reason: "parser found an injection" };
  if (parserVerdict !== "clean") return { status: "pending", reason: `parser verdict ${parserVerdict ?? "none"} waits for the judge or an approver` };
  if (plan.detonator === "always" || (plan.detonator === "if_executable" && executable)) return { status: "pending", reason: "executable content waits for the detonator and its approver" };
  const human = actor === "owner" || actor === "claw_admin";
  switch (plan.approver) {
    case "automatic_if_clean":
      return { status: "approved", via: "checks_passed", reason: "clean" };
    case "owner":
    case "owner_or_claw_admin":
      return human ? { status: "approved", via: actor, reason: "clean, approved by the writer" } : { status: "pending", reason: `waits for the ${plan.approver.replace(/_/g, " ")}` };
    case "claw_admin":
      return actor === "claw_admin" ? { status: "approved", via: actor, reason: "clean, approved by the admin" } : { status: "pending", reason: "waits for a claw admin" };
    default:
      return { status: "pending", reason: `waits for ${plan.approver}` };
  }
}

async function filesOf(skill: SkillRow): Promise<SkillBundleFile[]> {
  if (skill.files) return skill.files;
  return prisma.skillFile.findMany({ where: { skillId: skill.id }, select: { relativePath: true, content: true, contentType: true }, orderBy: { relativePath: "asc" } });
}

async function lastApprovedBundle(orgId: string, subjectKey: string, exceptSha256: string): Promise<SkillBundle | null> {
  const v = await governancePrisma.staticContentVersion.findFirst({ where: { orgId, subjectKey, approvalStatus: "approved", contentSha256: { not: exceptSha256 } }, orderBy: { createdAt: "desc" }, select: { bytesStoragePath: true, contentSha256: true } });
  return v?.bytesStoragePath ? loadBundle(v.bytesStoragePath, v.contentSha256) : null;
}

/** The version row for the bytes the skill row holds right now, if any. */
export async function currentSkillVersion(skill: SkillRow) {
  const { sha256 } = hashSkillBundle({ name: skill.name, description: skill.description ?? "", content: skill.content, files: await filesOf(skill) });
  return governancePrisma.staticContentVersion.findFirst({ where: { orgId: skill.orgId, subjectKey: subjectKeyOf(skill.id), contentSha256: sha256 } });
}

/** A stored bundle serves only if it still hashes to the version it belongs to. */
export async function loadBundle(path: string, expectedSha256: string): Promise<SkillBundle | null> {
  try {
    const b = JSON.parse((await (await storage()).getFileBuffer(path)).toString("utf8")) as SkillBundle;
    if (typeof b?.content !== "string" || !Array.isArray(b.files)) return null;
    if (hashSkillBundle(b).sha256 !== expectedSha256) {
      log.error(`[skill-versions] bundle ${path} does not hash to its version ${expectedSha256.slice(0, 12)}; refusing it`);
      return null;
    }
    return b;
  } catch (err) {
    log.warn(`[skill-versions] bundle ${path} unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Records the skill's current bundle as a version and decides its approval. Never throws: the write it follows already happened. */
export async function commitSkillVersion(skill: SkillRow, write: SkillWrite): Promise<SkillVersionOutcome | null> {
  if (componentMode("registry") === "off") return null;
  try {
    const bundle: SkillBundle = { name: skill.name, description: skill.description ?? "", content: skill.content, files: await filesOf(skill) };
    const { sha256, executable, files } = hashSkillBundle(bundle);
    const subjectKey = subjectKeyOf(skill.id);
    const known = await governancePrisma.staticContentVersion.findFirst({ where: { orgId: skill.orgId, subjectKey }, orderBy: { createdAt: "desc" }, select: { id: true, contentSha256: true, bytesStoragePath: true } });
    const sameHash = known?.contentSha256 === sha256 ? known : await governancePrisma.staticContentVersion.findFirst({ where: { orgId: skill.orgId, subjectKey, contentSha256: sha256 }, select: { id: true, contentSha256: true, bytesStoragePath: true } });
    // The blob is uploaded once per hash; a row left without its blob by an earlier failure is repaired here.
    let path: string | undefined = sameHash?.bytesStoragePath ?? undefined;
    if (!path) {
      path = await (await storage()).uploadFile(Buffer.from(JSON.stringify(bundle)), bundlePath(skill.orgId, sha256), "application/json").then(
        () => bundlePath(skill.orgId, sha256),
        (err) => { log.error(`[skill-versions] bundle upload failed for ${skill.slug}; the version is recorded without its bytes: ${err instanceof Error ? err.message : String(err)}`); return undefined; },
      );
      if (path && sameHash) await governancePrisma.staticContentVersion.update({ where: { id: sameHash.id }, data: { bytesStoragePath: path } });
    }
    const { version, created } = await commitStaticContentVersion({
      orgId: skill.orgId,
      contentKind: "skill",
      subjectKey,
      text: skillScanText(bundle),
      contentSha256: sha256,
      bytesStoragePath: path,
      writtenBy: write.writtenBy,
      writtenByUserId: write.userId,
      writtenByAgentId: write.agentId,
      writtenInConversationId: write.conversationId,
      supersedesVersionId: known?.id,
    });
    let status = version.approvalStatus;
    if (created) {
      const verdict = (version.parserVerdict ?? undefined) as Verdict | undefined;
      let decision: ReturnType<typeof decideSkillApproval>;
      if (write.baselineIfFirst && !known) decision = { status: "approved", via: "baseline", reason: "in use before the registry" };
      else if (write.writtenBy === "seed" || write.writtenBy === "build") decision = verdict === "clean" && !executable ? { status: "approved", via: "ci_build", reason: "built-in content, clean" } : verdict === "injection" ? { status: "rejected", reason: "parser found an injection" } : { status: "pending", reason: `built-in content with parser verdict ${verdict ?? "none"}` };
      else {
        const scope = skill.scope === "global" ? "global" : "personal";
        const change = write.writtenBy === "agent" ? "written_by_agent" : executable && (await executableChanged(skill.orgId, subjectKey, sha256, files)) ? "executable_changed" : "text_edit_by_person";
        decision = decideSkillApproval(planChecks({ mode: "static", kind: "skill", change, writtenBy: write.writtenBy, scope, executable }), verdict, executable, write.approvedVia);
      }
      if (decision.status !== "pending") {
        await setStaticContentApproval(version.id, { approvalStatus: decision.status, approvedVia: decision.via, actorUserId: write.userId, actorKind: write.writtenBy === "admin" ? "admin" : write.userId ? "user" : "system" });
        status = decision.status;
      }
      log.info(`[skill-versions] ${skill.slug} version ${version.id} ${sha256.slice(0, 12)} ${status} (${decision.reason}) by ${write.writtenBy}${executable ? ", executable" : ""}`);
    }
    return { versionId: version.id, sha256, status, created, parserVerdict: (version.parserVerdict ?? undefined) as Verdict | undefined };
  } catch (err) {
    log.error(`[skill-versions] commit failed for ${skill.slug}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Did any executable file change against the last approved bundle? Unknown counts as changed. */
async function executableChanged(orgId: string, subjectKey: string, sha256: string, files: Array<[string, number, string]>): Promise<boolean> {
  const previous = await lastApprovedBundle(orgId, subjectKey, sha256);
  if (!previous) return true;
  const before = JSON.stringify(hashSkillBundle(previous).files.filter((f) => f[1] === 1));
  return before !== JSON.stringify(files.filter((f) => f[1] === 1));
}

/** The one loader: pins every registry skill a run loads, and in enforce mode serves only approved bytes. */
export async function resolveRunSkills(skills: readonly SkillRow[], runId?: string | undefined): Promise<{ skills: RunSkill[]; manifest: ManifestEntry[] }> {
  const strip = (s: SkillRow): RunSkill => ({ slug: s.slug, name: s.name, description: s.description ?? "", content: s.content, ...(s.files && s.files.length > 0 ? { files: s.files } : {}) });
  const mode = componentMode("registry");
  if (mode === "off" || skills.length === 0) return { skills: skills.map(strip), manifest: [] };
  const hashed = skills.map((s) => ({ skill: s, ...hashSkillBundle({ name: s.name, description: s.description ?? "", content: s.content, files: s.files ?? [] }) }));
  let rows: Array<{ id: string; orgId: string; subjectKey: string; contentSha256: string; approvalStatus: string; overrideExpiresAt: Date | null; bytesStoragePath: string | null; createdAt: Date }> = [];
  try {
    rows = await governancePrisma.staticContentVersion.findMany({
      where: { orgId: { in: [...new Set(skills.map((s) => s.orgId))] }, subjectKey: { in: skills.map((s) => subjectKeyOf(s.id)) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, orgId: true, subjectKey: true, contentSha256: true, approvalStatus: true, overrideExpiresAt: true, bytesStoragePath: true, createdAt: true },
    });
  } catch (err) {
    // The registry answered nothing: serve what the run had, and say so.
    log.error(`[skill-versions] registry lookup failed, serving unpinned: ${err instanceof Error ? err.message : String(err)}`);
    return { skills: skills.map(strip), manifest: [] };
  }
  const now = Date.now();
  const approved = (v: { approvalStatus: string; overrideExpiresAt: Date | null }): boolean => v.approvalStatus === "approved" && !(v.overrideExpiresAt && v.overrideExpiresAt.getTime() < now);
  const out: RunSkill[] = [];
  const manifest: ManifestEntry[] = [];
  for (const { skill, sha256 } of hashed) {
    const key = subjectKeyOf(skill.id);
    const versions = rows.filter((v) => v.orgId === skill.orgId && v.subjectKey === key);
    let current = versions.find((v) => v.contentSha256 === sha256);
    if (versions.length === 0) {
      const baseline = await commitSkillVersion(skill, { writtenBy: skill.scope === "global" ? "seed" : "person", baselineIfFirst: true });
      if (baseline) current = { id: baseline.versionId, orgId: skill.orgId, subjectKey: key, contentSha256: sha256, approvalStatus: baseline.status, overrideExpiresAt: null, bytesStoragePath: null, createdAt: new Date() };
    }
    if (current && approved(current)) {
      out.push({ ...strip(skill), versionId: current.id, contentSha256: sha256 });
      manifest.push({ skillId: skill.id, slug: skill.slug, sha256, versionId: current.id, status: "approved", served: "current" });
      continue;
    }
    const previous = versions.find((v) => v.contentSha256 !== sha256 && approved(v));
    const status = current?.approvalStatus ?? "unregistered";
    if (mode === "enforce") {
      const bundle = previous?.bytesStoragePath ? await loadBundle(previous.bytesStoragePath, previous.contentSha256) : null;
      if (bundle && previous) {
        out.push({ slug: skill.slug, name: bundle.name, description: bundle.description, content: bundle.content, ...(bundle.files.length > 0 ? { files: bundle.files } : {}), versionId: previous.id, contentSha256: previous.contentSha256 });
        manifest.push({ skillId: skill.id, slug: skill.slug, sha256: previous.contentSha256, versionId: previous.id, status: `${status}; served previous`, served: "previous" });
      } else {
        manifest.push({ skillId: skill.id, slug: skill.slug, sha256, versionId: current?.id ?? null, status: `${status}; hidden`, served: "none" });
      }
      log.warn(`[skill-versions] ${skill.slug} is ${status}: ${bundle ? `serving approved ${previous?.contentSha256.slice(0, 12)}` : "hidden"}${runId ? ` run=${runId}` : ""}`);
    } else {
      out.push({ ...strip(skill), ...(current ? { versionId: current.id } : {}), contentSha256: sha256 });
      manifest.push({ skillId: skill.id, slug: skill.slug, sha256, versionId: current?.id ?? null, status: `${status}; shadow served current, enforce would ${previous ? "serve previous" : "hide"}`, served: "current" });
      log.warn(`[skill-versions] shadow: ${skill.slug} is ${status}; enforce would ${previous ? `serve ${previous.contentSha256.slice(0, 12)}` : "hide it"}${runId ? ` run=${runId}` : ""}`);
    }
  }
  return { skills: out, manifest };
}

export interface VersionActor {
  userId: string;
  isAdmin: boolean;
}

/** Puts an earlier approved version's bytes back on the skill row; the write re-commits to that approved hash. */
export async function rollbackSkill(skill: SkillRow, versionId: string, actor: VersionActor): Promise<{ ok: true; sha256: string } | { ok: false; error: string }> {
  const version = await governancePrisma.staticContentVersion.findUnique({ where: { id: versionId } });
  if (!version || version.orgId !== skill.orgId || version.subjectKey !== subjectKeyOf(skill.id)) return { ok: false, error: "Version not found" };
  if (version.approvalStatus !== "approved") return { ok: false, error: "Only an approved version can be rolled back to" };
  const bundle = version.bytesStoragePath ? await loadBundle(version.bytesStoragePath, version.contentSha256) : null;
  if (!bundle) return { ok: false, error: "The version's bundle is not in storage" };
  await prisma.$transaction(async (tx) => {
    await tx.skill.update({ where: { id: skill.id }, data: { name: bundle.name, description: bundle.description, content: bundle.content } });
    await tx.skillFile.deleteMany({ where: { skillId: skill.id } });
    if (bundle.files.length > 0) await tx.skillFile.createMany({ data: bundle.files.map((f) => ({ skillId: skill.id, relativePath: f.relativePath, content: f.content, contentType: f.contentType ?? null, sizeBytes: Buffer.byteLength(f.content, "utf8") })) });
  });
  await commitSkillVersion({ ...skill, ...bundle }, { writtenBy: actor.isAdmin ? "admin" : "person", userId: actor.userId, approvedVia: actor.isAdmin ? "claw_admin" : "owner" });
  queueGovernanceEvent({ orgId: skill.orgId, eventType: "version_status_changed", actorKind: actor.isAdmin ? "admin" : "user", actorId: actor.userId, subjectKind: "skill", subjectId: subjectKeyOf(skill.id), contentSha256After: version.contentSha256, decision: "allow", reasonText: `rolled back to version ${version.id}` });
  return { ok: true, sha256: version.contentSha256 };
}

/** A person's decision on a pending version. The route checks that the person is the owner or an admin and not a run's credential. */
export async function decideSkillVersion(skill: SkillRow, versionId: string, decision: "approve" | "reject", actor: VersionActor, reason?: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const version = await governancePrisma.staticContentVersion.findUnique({ where: { id: versionId } });
  if (!version || version.orgId !== skill.orgId || version.subjectKey !== subjectKeyOf(skill.id)) return { ok: false, error: "Version not found" };
  // A version the parser blocked can only be released by a claw admin's written override.
  const blocked = version.parserVerdict === "injection" || version.approvalStatus === "rejected";
  const override = decision === "approve" && blocked;
  if (version.approvalStatus !== "pending" && version.approvalStatus !== "held" && !override) return { ok: false, error: `Version is ${version.approvalStatus}` };
  if (override && !actor.isAdmin) return { ok: false, error: "A version the parser blocked needs a claw admin override" };
  if (override && !reason?.trim()) return { ok: false, error: "An override needs a written reason" };
  if (decision === "approve" && skill.scope === "global" && !actor.isAdmin) return { ok: false, error: "Only a claw admin approves a global skill" };
  const updated = await setStaticContentApproval(version.id, { approvalStatus: decision === "approve" ? "approved" : "rejected", approvedVia: override ? "admin_override" : actor.isAdmin ? "claw_admin" : "owner", actorUserId: actor.userId, actorKind: actor.isAdmin ? "admin" : "user", overrideReason: reason });
  return { ok: true, status: updated.approvalStatus };
}

export function listSkillVersions(skill: SkillRow) {
  return governancePrisma.staticContentVersion.findMany({
    where: { orgId: skill.orgId, subjectKey: subjectKeyOf(skill.id) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, contentSha256: true, approvalStatus: true, approvedVia: true, approvedByUserId: true, approvedAt: true, writtenBy: true, writtenByUserId: true, writtenByAgentId: true, parserVerdict: true, judgeVerdict: true, detonatorVerdict: true, scannerVersion: true, supersedesVersionId: true, createdAt: true },
  });
}

/** Gives every skill still without a version its baseline, in the background, so a deploy hides nothing. */
export async function backfillSkillBaselines(): Promise<number> {
  if (componentMode("registry") === "off") return 0;
  let done = 0;
  try {
    const registered = new Set((await governancePrisma.staticContentVersion.findMany({ where: { contentKind: "skill" }, distinct: ["subjectKey"], select: { subjectKey: true } })).map((v) => v.subjectKey));
    const skills = await prisma.skill.findMany({ select: { id: true, orgId: true, slug: true, name: true, description: true, content: true, scope: true, source: true }, orderBy: { createdAt: "asc" } });
    for (const s of skills) {
      if (registered.has(subjectKeyOf(s.id))) continue;
      const r = await commitSkillVersion(s, { writtenBy: s.source === "seeded" ? "seed" : s.source === "agent-authored" ? "agent" : "person", baselineIfFirst: true });
      if (r) done++;
    }
    if (done > 0) log.info(`[skill-versions] baseline backfill: ${done} skill(s) got version 1`);
  } catch (err) {
    log.error(`[skill-versions] baseline backfill failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return done;
}
