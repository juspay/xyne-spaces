import { beforeEach, describe, expect, it, vi } from "vitest";

const findAccountOnNumberForSender = vi.fn(async (_input: Record<string, string>) => null as unknown);

vi.mock("./store.js", () => ({ findAccountOnNumberForSender }));

const { accountForSender } = await import("./shared-number.js");

const acct = (id: string, orgId: string) =>
  ({ id, orgId, channel: "whatsapp-cloud", surfaceId: "s-wa", accountKey: `acct_${id}`, config: { selfId: "pn-1" } }) as never;

const orgA = acct("a", "org-a");
const orgB = acct("b", "org-b");
const orgPlugin = { accountScope: "org" } as never;

describe("accountForSender", () => {
  beforeEach(() => findAccountOnNumberForSender.mockReset());

  it("hands the message to the account the lookup finds", async () => {
    findAccountOnNumberForSender.mockResolvedValue(orgB);
    expect(await accountForSender({ account: orgA, plugin: orgPlugin }, "919")).toBe(orgB);
    expect(findAccountOnNumberForSender).toHaveBeenCalledWith({ surfaceId: "s-wa", selfId: "pn-1", senderId: "919" });
  });

  it("stays on the receiving account when the sender is linked nowhere on this number", async () => {
    findAccountOnNumberForSender.mockResolvedValue(null);
    expect(await accountForSender({ account: orgB, plugin: orgPlugin }, "919")).toBe(orgB);
  });

  it("never looks across orgs for a personal account", async () => {
    expect(await accountForSender({ account: orgA, plugin: { accountScope: "user" } as never }, "919")).toBe(orgA);
    expect(findAccountOnNumberForSender).not.toHaveBeenCalled();
  });
});
