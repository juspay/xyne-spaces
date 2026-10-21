import { describe, expect, it, vi } from "vitest";

vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("../../config.js", () => ({ CONFIG: { selfUrl: "http://localhost", internalUrl: "http://localhost" } }));

const { selfOf, whatsappPlugin } = await import("./plugin.js");

const JID = "918667338331@s.whatsapp.net";
const LID = "233079436239007@lid";

/** Only the two fields selfOf reads. */
function handle(sockUser: { id: string; lid?: string } | undefined, selfAltId?: string) {
  return {
    sock: sockUser ? { user: sockUser } : null,
    ctx: { account: { config: { ...(selfAltId ? { selfAltId } : {}) } } },
  } as unknown as Parameters<typeof selfOf>[0];
}

describe("account identity", () => {
  it("takes the LID from the socket when it has one", () => {
    expect(selfOf(handle({ id: JID, lid: LID }))).toEqual({ jid: JID, lid: LID });
  });

  it("falls back to the stored LID when a login arrives without one", () => {
    // Baileys rewrites `me` wholesale on every login, so a success node with
    // no lid sets it to undefined. Losing it makes the owner's own chat
    // unrecognisable, so the stored copy has to win here.
    expect(selfOf(handle({ id: JID }, LID))).toEqual({ jid: JID, lid: LID });
  });

  it("prefers the socket over a stale stored value", () => {
    expect(selfOf(handle({ id: JID, lid: LID }, "99999@lid"))).toEqual({ jid: JID, lid: LID });
  });

  it("has no LID when neither source has one, rather than inventing it", () => {
    expect(selfOf(handle({ id: JID }))).toEqual({ jid: JID });
  });

  it("is nothing at all before the socket knows who it is", () => {
    expect(selfOf(handle(undefined, LID))).toBeNull();
  });
});

describe("resolveTarget group matching", () => {
  const sock = {
    groupFetchAllParticipating: async () => ({
      a: { id: "a@g.us", subject: "dev", participants: [1, 2, 3] },
      b: { id: "b@g.us", subject: "dev-ops-oncall", participants: [1] },
      c: { id: "c@g.us", subject: "design", participants: [1] },
    }),
  };
  const live = { sock, ctx: { account: { id: "acc" }, logger: { info: vi.fn(), warn: vi.fn() } } } as never;
  const resolve = (target: string) => whatsappPlugin.resolveTarget!(live, target);

  it("prefers an exact name over any substring of it", async () => {
    await expect(resolve("dev")).resolves.toBe("a@g.us");
  });

  it("accepts a substring that names exactly one group", async () => {
    await expect(resolve("oncall")).resolves.toBe("b@g.us");
  });

  it("refuses to guess between two matches", async () => {
    // "de" is in all three. Picking one would send somebody's message to a
    // room they did not name.
    await expect(resolve("de")).resolves.toBeNull();
  });

  it("returns nothing when no group matches", async () => {
    await expect(resolve("marketing")).resolves.toBeNull();
  });
});
