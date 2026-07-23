// Focused unit tests for resolveSkillUpdateRequest — the approve/decline
// orchestration behind the skill-update DM card. The pure diff/hash/authz logic
// lives in xyne-claw-shared (exhaustively covered there); here we mock the
// repositories + side-effect modules and assert the SECURITY-CRITICAL wiring:
//   • only the owner (or admin) can apply a change
//   • a skill that drifted since the proposal is rejected (409, optimistic lock)
//   • approve applies EXACTLY the reviewed content (integrity hash) via the
//     atomic claim, and reverts on failure
//   • replays are idempotent
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSkillContent, normalizeSkillContent } from "xyne-claw-shared";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const state = vi.hoisted(() => ({
  skill: null as any,
  request: null as any,
  isAdmin: false,
  claimCount: 1,
  updateCalls: [] as any[],
  claimCalls: [] as any[],
  revertCalls: [] as string[],
}));

vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: Buffer.from("00".repeat(32), "hex"), spacesAppUrl: "http://spaces", spacesInternalUrl: "http://spaces" } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock("../lib/audit.js", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("../lib/spaces-db.js", () => ({ getWorkspaceIdForUser: vi.fn(async () => "ws-1") }));
vi.mock("../lib/spaces-api.js", () => ({ spacesAppFetch: vi.fn(async () => ({ channelId: "c" })) }));
vi.mock("../crypto.js", () => ({ decrypt: vi.fn(() => "tok"), encrypt: vi.fn() }));
vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: vi.fn(),
  getOrgId: vi.fn(),
  isClawAdmin: vi.fn(async () => state.isAdmin),
  requireClawAdmin: vi.fn(),
}));
vi.mock("../repositories/index.js", () => ({
  skillRepository: {
    findById: vi.fn(async () => state.skill),
    findBySlug: vi.fn(async () => state.skill),
    update: vi.fn(async (slug: string, orgId: string, data: any) => { state.updateCalls.push({ slug, orgId, data }); return { ...state.skill, ...data }; }),
  },
  agentRequestRepository: {
    findById: vi.fn(async () => state.request),
    claimPendingSkillUpdate: vi.fn(async (id: string, status: string, reviewerId: string) => { state.claimCalls.push({ id, status, reviewerId }); return { count: state.claimCount }; }),
    revertSkillUpdateToPending: vi.fn(async (id: string) => { state.revertCalls.push(id); return state.request; }),
  },
  agentRepository: { findBySlug: vi.fn(async () => null) },
  userRepository: { findById: vi.fn(async () => ({ id: "u", name: "U", email: "u@x" })) },
}));

const OWNER = "owner-1";
const OTHER = "other-2";
const BASE = "# Skill\nold body\n";
const NEW = "# Skill\nnew body\n";

function makeSkill(over: Partial<any> = {}) {
  return { id: "sk1", slug: "my-skill", name: "My Skill", orgId: "org1", scope: "personal", ownerUserId: OWNER, promotedBy: null, content: BASE, ...over };
}
function makeRequest(over: Partial<any> = {}) {
  return {
    id: "req1", requestType: "skill_update", skillId: "sk1", skillSlug: "my-skill",
    requesterId: OTHER, status: "pending",
    proposedContent: normalizeSkillContent(NEW),
    baseContentHash: hashSkillContent(BASE),
    proposedContentHash: hashSkillContent(normalizeSkillContent(NEW)),
    ...over,
  };
}

let resolveSkillUpdateRequest: typeof import("./skills.js")["resolveSkillUpdateRequest"];
let canProposerPostAsAgent: typeof import("./skills.js")["canProposerPostAsAgent"];

beforeEach(async () => {
  vi.clearAllMocks();
  state.skill = makeSkill();
  state.request = makeRequest();
  state.isAdmin = false;
  state.claimCount = 1;
  state.updateCalls = [];
  state.claimCalls = [];
  state.revertCalls = [];
  ({ resolveSkillUpdateRequest, canProposerPostAsAgent } = await import("./skills.js"));
});

describe("resolveSkillUpdateRequest", () => {
  it("owner approve applies the reviewed content atomically", async () => {
    const r = await resolveSkillUpdateRequest("req1", OWNER, "approve");
    expect(r).toMatchObject({ ok: true, status: "approved" });
    expect(state.claimCalls[0]).toMatchObject({ id: "req1", status: "approved", reviewerId: OWNER });
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0].data.content).toBe(normalizeSkillContent(NEW));
    expect(state.revertCalls).toHaveLength(0);
  });

  it("non-owner, non-admin approve is rejected 403 and never writes", async () => {
    const r = await resolveSkillUpdateRequest("req1", OTHER, "approve");
    expect(r).toMatchObject({ ok: false, code: 403 });
    expect(state.updateCalls).toHaveLength(0);
    expect(state.claimCalls).toHaveLength(0);
  });

  it("admin can approve on the owner's behalf", async () => {
    state.isAdmin = true;
    const r = await resolveSkillUpdateRequest("req1", OTHER, "approve");
    expect(r).toMatchObject({ ok: true, status: "approved" });
    expect(state.updateCalls).toHaveLength(1);
  });

  it("rejects when the skill drifted since the proposal (409, optimistic lock)", async () => {
    state.skill = makeSkill({ content: "# Skill\nsomeone else edited\n" });
    const r = await resolveSkillUpdateRequest("req1", OWNER, "approve");
    expect(r).toMatchObject({ ok: false, code: 409 });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("global skill requires an admin approver", async () => {
    state.skill = makeSkill({ scope: "global", ownerUserId: OWNER });
    const nonAdmin = await resolveSkillUpdateRequest("req1", OWNER, "approve");
    expect(nonAdmin).toMatchObject({ ok: false, code: 403 });
    state.isAdmin = true;
    const admin = await resolveSkillUpdateRequest("req1", OWNER, "approve");
    expect(admin).toMatchObject({ ok: true, status: "approved" });
  });

  it("decline claims the row as rejected and never writes content", async () => {
    const r = await resolveSkillUpdateRequest("req1", OWNER, "reject");
    expect(r).toMatchObject({ ok: true, status: "rejected" });
    expect(state.claimCalls[0]).toMatchObject({ status: "rejected" });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("is idempotent when the request was already resolved", async () => {
    state.request = makeRequest({ status: "approved" });
    const r = await resolveSkillUpdateRequest("req1", OWNER, "approve");
    expect(r).toMatchObject({ ok: true, status: "approved", alreadyResolved: true });
    expect(state.claimCalls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("lost claim race (count=0) resolves as alreadyResolved, no write", async () => {
    state.claimCount = 0;
    state.request = makeRequest({ status: "pending" });
    // findById is called twice: initial + the alreadyResolved re-read. Make the
    // re-read report the winner's terminal state.
    const repo = await import("../repositories/index.js");
    (repo.agentRequestRepository.findById as any)
      .mockResolvedValueOnce(makeRequest({ status: "pending" }))
      .mockResolvedValueOnce(makeRequest({ status: "approved" }));
    const r = await resolveSkillUpdateRequest("req1", OWNER, "approve");
    expect(r).toMatchObject({ ok: true, alreadyResolved: true });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("integrity failure (proposed content hash mismatch) reverts the claim", async () => {
    state.request = makeRequest({ proposedContentHash: "deadbeef" });
    const r = await resolveSkillUpdateRequest("req1", OWNER, "approve");
    expect(r).toMatchObject({ ok: false, code: 409 });
    expect(state.updateCalls).toHaveLength(0);
    expect(state.revertCalls).toContain("req1");
  });

  it("404 when request is missing or not a skill_update", async () => {
    state.request = null;
    const r = await resolveSkillUpdateRequest("nope", OWNER, "approve");
    expect(r).toMatchObject({ ok: false, code: 404 });
  });
});

describe("canProposerPostAsAgent (R1: posting-agent identity is authorized, not body-trusted)", () => {
  it("allows the agent's owner to post as it", () => {
    expect(canProposerPostAsAgent({ canEdit: true, agent: { scope: "personal" } })).toBe(true);
  });
  it("allows a contributor (canEdit) to post as it", () => {
    // getAgentEditAccess sets canEdit for EDITOR/CONTRIBUTOR shares
    expect(canProposerPostAsAgent({ canEdit: true, agent: { scope: "global" } })).toBe(true);
  });
  it("allows any org member to post as a shared GLOBAL agent", () => {
    expect(canProposerPostAsAgent({ canEdit: false, agent: { scope: "global" } })).toBe(true);
  });
  it("REJECTS an unrelated personal agent the requester cannot edit (impersonation guard)", () => {
    expect(canProposerPostAsAgent({ canEdit: false, agent: { scope: "personal" } })).toBe(false);
  });
  it("REJECTS a null access (cross-org / unknown slug / not visible)", () => {
    expect(canProposerPostAsAgent(null)).toBe(false);
    expect(canProposerPostAsAgent(undefined)).toBe(false);
  });
});
