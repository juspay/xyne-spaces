import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  verdict: "clean" as string | null,
  known: null as null | { id: string; contentSha256: string },
  versions: [] as Array<Record<string, unknown>>,
  stored: new Map<string, string>(),
  files: [] as Array<{ relativePath: string; content: string; contentType: string | null }>,
  commits: [] as Array<Record<string, unknown>>,
  approvals: [] as Array<[string, Record<string, unknown>]>,
  events: [] as Array<Record<string, unknown>>,
  rowWrites: [] as Array<Record<string, unknown>>,
}));

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("../services/storageService.js", () => ({
  gcsService: {
    uploadFile: vi.fn(async (buf: Buffer, path: string) => { state.stored.set(path, buf.toString("utf8")); }),
    getFileBuffer: vi.fn(async (path: string) => { const s = state.stored.get(path); if (s === undefined) throw new Error("missing"); return Buffer.from(s); }),
  },
}));
vi.mock("./governance-audit.js", () => ({ queueGovernanceEvent: vi.fn((e: Record<string, unknown>) => { state.events.push(e); }) }));
vi.mock("./governance-registry.js", () => ({
  commitStaticContentVersion: vi.fn(async (input: Record<string, unknown>) => {
    state.commits.push(input);
    return { version: { id: `v-${state.commits.length}`, orgId: input["orgId"], subjectKey: input["subjectKey"], contentSha256: input["contentSha256"], approvalStatus: "pending", parserVerdict: state.verdict }, created: true };
  }),
  setStaticContentApproval: vi.fn(async (id: string, input: Record<string, unknown>) => { state.approvals.push([id, input]); return { id, approvalStatus: input["approvalStatus"] }; }),
}));
vi.mock("../db.js", () => ({
  prisma: {
    skillFile: { findMany: vi.fn(async () => state.files) },
    skill: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({
      skill: { update: vi.fn(async (a: Record<string, unknown>) => { state.rowWrites.push({ skill: a }); }) },
      skillFile: { deleteMany: vi.fn(async () => undefined), createMany: vi.fn(async (a: Record<string, unknown>) => { state.rowWrites.push({ files: a }); }) },
    })),
  },
  governancePrisma: {
    staticContentVersion: {
      findFirst: vi.fn(async (q: { where: Record<string, unknown> }) => (q.where["approvalStatus"] === "approved" ? (state.versions.find((v) => v["approvalStatus"] === "approved" && v["contentSha256"] !== (q.where["contentSha256"] as { not: string }).not) ?? null) : state.known)),
      findMany: vi.fn(async (q: { where: { orgId: { in: string[] } } }) => { if (q.where.orgId.in.includes("boom")) throw new Error("db down"); return state.versions; }),
      findUnique: vi.fn(async (q: { where: { id: string } }) => state.versions.find((v) => v["id"] === q.where.id) ?? null),
    },
  },
}));

const { commitSkillVersion, decideSkillApproval, decideSkillVersion, hashSkillBundle, resolveRunSkills, rollbackSkill } = await import("./skill-versions.js");
const { planChecks, resetComponentModes } = await import("xyne-claw-shared/governance");

const skill = { id: "sk1", orgId: "org-1", slug: "runbook", name: "Runbook", description: "How we ship", content: "1. tag\n2. deploy", scope: "personal", files: [] };
const sha = (s: Parameters<typeof hashSkillBundle>[0]) => hashSkillBundle(s).sha256;
const version = (over: Record<string, unknown>) => ({ id: "v0", orgId: "org-1", subjectKey: "skill:sk1", approvalStatus: "approved", overrideExpiresAt: null, bytesStoragePath: null, createdAt: new Date(), parserVerdict: "clean", ...over });

beforeEach(() => {
  state.verdict = "clean";
  state.known = null;
  state.versions = [];
  state.stored.clear();
  state.files = [];
  state.commits.length = state.approvals.length = state.events.length = state.rowWrites.length = 0;
  delete process.env["GOVERNANCE_MODE"];
  delete process.env["GOVERNANCE_COMPONENT_MODES"];
  resetComponentModes();
});

describe("hashSkillBundle", () => {
  it("ignores file order and CRLF, and changes with content, bytes or a script path", () => {
    const a = { ...skill, files: [{ relativePath: "b.md", content: "B" }, { relativePath: "a.md", content: "A" }] };
    const b = { ...skill, content: "1. tag\r\n2. deploy", files: [{ relativePath: "a.md", content: "A" }, { relativePath: "b.md", content: "B" }] };
    expect(sha(a)).toBe(sha(b));
    expect(sha({ ...a, content: "1. tag" })).not.toBe(sha(a));
    expect(sha({ ...a, files: [{ relativePath: "a.md", content: "A!" }, { relativePath: "b.md", content: "B" }] })).not.toBe(sha(a));
    expect(hashSkillBundle({ ...a, files: [...a.files, { relativePath: "scripts/run.sh", content: "echo" }] })).toMatchObject({ executable: true });
  });
});

describe("decideSkillApproval", () => {
  const plan = (change: "text_edit_by_person" | "written_by_agent" | "executable_changed", scope: "personal" | "global", executable = false) => planChecks({ mode: "static", kind: "skill", change, writtenBy: "person", scope, executable });
  it.each([
    ["text_edit_by_person", "personal", "clean", false, undefined, "approved", "checks_passed"],
    ["text_edit_by_person", "global", "clean", false, "owner", "approved", "owner"],
    ["text_edit_by_person", "global", "clean", false, undefined, "pending", undefined],
    ["text_edit_by_person", "personal", "unsure", false, "owner", "pending", undefined],
    ["text_edit_by_person", "personal", "injection", false, "claw_admin", "rejected", undefined],
    ["written_by_agent", "personal", "clean", false, "owner", "approved", "owner"],
    ["executable_changed", "personal", "clean", true, "owner", "pending", undefined],
  ] as const)("%s on a %s skill, parser %s, executable %s, by %s → %s", (change, scope, verdict, executable, actor, status, via) => {
    expect(decideSkillApproval(plan(change, scope, executable), verdict, executable, actor)).toMatchObject({ status, ...(via ? { via } : {}) });
  });
});

describe("commitSkillVersion", () => {
  it("stores the bundle by hash, scans SKILL.md with its text files, and approves a clean personal edit", async () => {
    const r = await commitSkillVersion({ ...skill, files: [{ relativePath: "notes.md", content: "keep calm" }, { relativePath: "logo.png", content: "aGk=", contentType: "image/png" }] }, { writtenBy: "person", userId: "u1", approvedVia: "owner" });
    expect(r).toMatchObject({ status: "approved", created: true, parserVerdict: "clean" });
    expect([...state.stored.keys()]).toEqual([`governance/skill-bundles/org-1/${r!.sha256}.json`]);
    expect(state.commits[0]).toMatchObject({ contentKind: "skill", subjectKey: "skill:sk1", contentSha256: r!.sha256, writtenBy: "person", writtenByUserId: "u1" });
    expect(state.commits[0]!["text"]).toContain("### notes.md\nkeep calm");
    expect(state.commits[0]!["text"]).not.toContain("aGk=");
    expect(state.approvals[0]).toEqual(["v-1", expect.objectContaining({ approvalStatus: "approved", approvedVia: "checks_passed", actorUserId: "u1" })]);
  });

  it("leaves an agent's unsure write pending, rejects an injection, and does nothing when the registry is off", async () => {
    state.verdict = "unsure";
    expect(await commitSkillVersion(skill, { writtenBy: "agent", userId: "u1", approvedVia: "owner" })).toMatchObject({ status: "pending" });
    expect(state.approvals).toHaveLength(0);
    state.verdict = "injection";
    expect(await commitSkillVersion(skill, { writtenBy: "person", userId: "u1", approvedVia: "owner" })).toMatchObject({ status: "rejected" });
    expect(state.approvals.at(-1)![1]).toMatchObject({ approvalStatus: "rejected" });
    process.env["GOVERNANCE_COMPONENT_MODES"] = "registry=off";
    resetComponentModes();
    expect(await commitSkillVersion(skill, { writtenBy: "person", userId: "u1" })).toBeNull();
  });

  it("never throws into the write it follows", async () => {
    state.files = null as never;
    expect(await commitSkillVersion({ ...skill, files: undefined }, { writtenBy: "person" })).toBeNull();
  });
});

describe("resolveRunSkills", () => {
  const current = sha(skill);
  it("serves an approved current hash with its version id", async () => {
    state.versions = [version({ contentSha256: current })];
    const r = await resolveRunSkills([skill]);
    expect(r.skills[0]).toMatchObject({ slug: "runbook", content: skill.content, versionId: "v0", contentSha256: current });
    expect(r.skills[0]).not.toHaveProperty("id");
    expect(r.manifest[0]).toMatchObject({ versionId: "v0", status: "approved", served: "current" });
  });

  it("serves a pending hash in shadow but the last approved bundle in enforce, and hides a skill with nothing approved", async () => {
    const old = { ...skill, content: "old body", files: [{ relativePath: "a.md", content: "A" }] };
    const oldSha = sha(old);
    state.stored.set(`governance/skill-bundles/org-1/${oldSha}.json`, JSON.stringify({ name: old.name, description: old.description, content: old.content, files: old.files }));
    state.versions = [version({ id: "v2", contentSha256: current, approvalStatus: "pending" }), version({ id: "v1", contentSha256: oldSha, bytesStoragePath: `governance/skill-bundles/org-1/${oldSha}.json` })];
    const shadow = await resolveRunSkills([skill]);
    expect(shadow.skills[0]).toMatchObject({ content: skill.content, versionId: "v2" });
    expect(shadow.manifest[0]!.status).toMatch(/pending; shadow served current, enforce would serve previous/);
    process.env["GOVERNANCE_COMPONENT_MODES"] = "registry=enforce";
    resetComponentModes();
    const enforce = await resolveRunSkills([skill]);
    expect(enforce.skills[0]).toMatchObject({ slug: "runbook", content: "old body", files: old.files, versionId: "v1", contentSha256: oldSha });
    expect(enforce.manifest[0]).toMatchObject({ served: "previous", versionId: "v1" });
    state.versions = [version({ id: "v2", contentSha256: current, approvalStatus: "rejected" })];
    const hidden = await resolveRunSkills([skill]);
    expect(hidden.skills).toEqual([]);
    expect(hidden.manifest[0]).toMatchObject({ served: "none", status: "rejected; hidden" });
  });

  it("gives a skill without any version its baseline and serves it, and serves unpinned when the registry answers nothing", async () => {
    const r = await resolveRunSkills([skill]);
    expect(state.approvals[0]![1]).toMatchObject({ approvalStatus: "approved", approvedVia: "baseline" });
    expect(r.skills[0]).toMatchObject({ versionId: "v-1", contentSha256: current });
    expect(r.manifest[0]).toMatchObject({ status: "approved", served: "current" });
    const down = await resolveRunSkills([{ ...skill, orgId: "boom" }]);
    expect(down.skills[0]).toMatchObject({ slug: "runbook", content: skill.content });
    expect(down.skills[0]!.versionId).toBeUndefined();
    expect(down.manifest).toEqual([]);
  });
});

describe("rollbackSkill and decideSkillVersion", () => {
  it("rolls back to an approved version's stored bytes and refuses anything else", async () => {
    const old = { name: "Runbook", description: "d", content: "old body", files: [{ relativePath: "a.md", content: "A", contentType: null }] };
    const oldSha = sha(old);
    state.stored.set(`governance/skill-bundles/org-1/${oldSha}.json`, JSON.stringify(old));
    state.versions = [version({ id: "v1", contentSha256: oldSha, bytesStoragePath: `governance/skill-bundles/org-1/${oldSha}.json` }), version({ id: "v3", contentSha256: "x", approvalStatus: "rejected" })];
    expect(await rollbackSkill(skill, "v3", { userId: "u1", isAdmin: false })).toMatchObject({ ok: false });
    expect(await rollbackSkill(skill, "v1", { userId: "u1", isAdmin: false })).toEqual({ ok: true, sha256: oldSha });
    expect(state.rowWrites[0]).toMatchObject({ skill: { where: { id: "sk1" }, data: { content: "old body" } } });
    expect(state.rowWrites[1]).toMatchObject({ files: { data: [expect.objectContaining({ relativePath: "a.md", skillId: "sk1" })] } });
    expect(state.commits[0]).toMatchObject({ contentSha256: oldSha, writtenBy: "person" });
    expect(state.events[0]).toMatchObject({ eventType: "version_status_changed", reasonText: "rolled back to version v1" });
  });

  it("lets the owner decide a pending personal version and only an admin a global one", async () => {
    state.versions = [version({ id: "v5", contentSha256: "y", approvalStatus: "pending" })];
    expect(await decideSkillVersion({ ...skill, scope: "global" }, "v5", "approve", { userId: "u1", isAdmin: false })).toMatchObject({ ok: false });
    expect(await decideSkillVersion(skill, "v5", "approve", { userId: "u1", isAdmin: false })).toEqual({ ok: true, status: "approved" });
    expect(state.approvals[0]).toEqual(["v5", expect.objectContaining({ approvalStatus: "approved", approvedVia: "owner", actorUserId: "u1" })]);
  });
});

describe("writer coverage", () => {
  // Every skill writer commits a version and the one loader resolves; a writer that forgets fails here.
  it.each([
    ["routes/skills.ts", "commitSkillVersion(", 4],
    ["lib/skill-apply.ts", "commitSkillVersion(", 1],
    ["../prisma/seed.ts", "commitSkillVersion(", 2],
    ["lib/start-run.ts", "resolveRunSkills(", 1],
  ])("%s calls %s at least %d time(s)", (file, needle, times) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source.split(needle).length - 1).toBeGreaterThanOrEqual(times);
  });
});
