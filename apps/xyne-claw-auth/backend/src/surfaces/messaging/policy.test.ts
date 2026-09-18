import { describe, expect, it } from "vitest";
import { evaluatePolicy, idInList } from "./policy.js";
import { parseAccountConfig, policyOf } from "./schema.js";

const policy = (over: Record<string, unknown> = {}) => policyOf(parseAccountConfig(over));

const input = (over: Partial<Parameters<typeof evaluatePolicy>[1]> = {}) => ({
  isGroup: false,
  senderId: "919876543210",
  chatId: "919876543210@s.whatsapp.net",
  hasIdentity: true,
  mentionedSelf: false,
  replyToSelf: false,
  ...over,
});

describe("idInList", () => {
  it("compares phone-ish ids by digits, whatever the surrounding syntax", () => {
    expect(idInList("+91 98765 43210", ["919876543210@s.whatsapp.net"])).toBe(true);
    expect(idInList("919876543210", ["918888888888"])).toBe(false);
  });

  it("treats a lone * as everyone", () => {
    expect(idInList("anyone-at-all", ["*"])).toBe(true);
  });
});

describe("direct messages", () => {
  it("ignores everything when dms are disabled", () => {
    expect(evaluatePolicy(policy({ dmPolicy: "disabled" }), input()).action).toBe("ignore");
  });

  it("tells an unknown sender to link their number", () => {
    expect(evaluatePolicy(policy(), input({ hasIdentity: false })).action).toBe("unlinked");
  });

  it("dispatches for a linked sender once requireMention is off", () => {
    expect(evaluatePolicy(policy({ requireMention: false }), input()).action).toBe("dispatch");
  });

  it("stays silent for a linked sender who did not address the agent", () => {
    expect(evaluatePolicy(policy({ requireMention: true }), input()).action).toBe("ignore");
  });

  it("counts an opening /slug as addressing the agent", () => {
    const decision = evaluatePolicy(policy({ requireMention: true }), input({ namedInText: true }));
    expect(decision.action).toBe("dispatch");
  });
});

describe("groups", () => {
  const group = { isGroup: true, chatId: "12036@g.us" };

  it("ignores a group that is not on the allowlist", () => {
    const decision = evaluatePolicy(policy({ groupAllowlist: ["99999@g.us"] }), input(group));
    expect(decision.action).toBe("ignore");
    expect(decision.remember).toBeUndefined();
  });

  it("remembers an unaddressed line in a group it does operate in", () => {
    const decision = evaluatePolicy(policy({ groupAllowlist: ["12036@g.us"] }), input(group));
    expect(decision.action).toBe("ignore");
    expect(decision.remember).toBe(true);
  });

  it("dispatches for anyone who addresses it there, linked or not", () => {
    const p = policy({ groupAllowlist: ["12036@g.us"] });
    for (const hasIdentity of [true, false]) {
      const decision = evaluatePolicy(p, input({ ...group, hasIdentity, mentionedSelf: true }));
      expect(decision.action).toBe("dispatch");
    }
  });

  it("answers every line once requireMention is off", () => {
    const p = policy({ groupPolicy: "open", requireMention: false });
    expect(evaluatePolicy(p, input(group)).action).toBe("dispatch");
  });
});

describe("self chat", () => {
  const self = { selfChat: true, hasIdentity: false };

  it("runs for the owner even with no identity row", () => {
    const p = policy({ dmPolicy: "disabled", requireMention: false });
    expect(evaluatePolicy(p, input(self)).action).toBe("dispatch");
  });

  it("still waits to be addressed when requireMention is on", () => {
    const p = policy({ requireMention: true });
    expect(evaluatePolicy(p, input(self)).action).toBe("ignore");
    expect(evaluatePolicy(p, input({ ...self, namedInText: true })).action).toBe("dispatch");
  });
});
