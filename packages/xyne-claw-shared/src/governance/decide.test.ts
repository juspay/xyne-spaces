import { describe, it, expect } from "vitest";
import { decide, matchKillSwitches } from "./decide.js";
import { isReasonCode, type ReasonCode } from "./reason-codes.js";
import {
  EFFECT_CLASSES,
  KILL_SCOPE_KINDS,
  KILL_SNAPSHOT_MAX_AGE_MS,
  POLICY_VERSION,
  type CallFacts,
  type CallScopes,
  type ConversationState,
  type CriticVerdict,
  type DecideInput,
  type DecisionKind,
  type Grant,
  type KillMode,
  type KillScopeKind,
  type KillSnapshot,
  type KillSwitch,
  type PolicyInput,
  type RiskLevel,
} from "./types.js";

const now = 1_000_000;
const snap = (switches: KillSwitch[] = [], takenAtMs = now): KillSnapshot => ({ epoch: 1, takenAtMs, switches });
const sw = (mode: KillMode, scopeKind: KillScopeKind = "agent", scopeId = "a1", expiresAtMs?: number): KillSwitch => ({
  scopeKind,
  scopeId,
  mode,
  epoch: 1,
  ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
});

type Patch = {
  call?: Partial<CallFacts>;
  kill?: Partial<DecideInput["kill"]>;
  conversation?: Partial<ConversationState>;
  critic?: Partial<CriticVerdict>;
  policy?: Partial<PolicyInput>;
};
const input = (p: Patch = {}): DecideInput => ({
  call: { toolName: "t", effect: "write", destination: { kind: "internal" }, ...p.call },
  kill: { snapshot: snap(), scopes: { agent: "a1", platform: "*" }, nowMs: now, ...p.kill },
  conversation: { risk: "none", privateData: false, pendingVerdicts: 0, readUntypedContent: false, ...p.conversation },
  critic: { status: "not_needed", ...p.critic },
  policy: { judgeAvailable: true, ...p.policy },
});
const externalSend: Partial<CallFacts> = { effect: "send", destination: { kind: "external", host: "x.example" } };

describe("decide", () => {
  const cases: Array<[string, Patch, DecisionKind, ReasonCode]> = [
    ["stop switch blocks even a read", { call: { effect: "read" }, kill: { snapshot: snap([sw("stop")]) } }, "block", "GOV-KILL-STOP"],
    ["read_only switch blocks a write", { kill: { snapshot: snap([sw("read_only")]) } }, "block", "GOV-KILL-READ-ONLY"],
    ["read_only switch allows a read", { call: { effect: "read" }, kill: { snapshot: snap([sw("read_only")]) } }, "allow", "GOV-ALLOW-READ"],
    ["ask_all switch asks a write", { kill: { snapshot: snap([sw("ask_all")]) } }, "ask", "GOV-KILL-ASK-ALL"],
    ["null snapshot blocks a write", { kill: { snapshot: null } }, "block", "GOV-KILL-STALE"],
    ["stale snapshot blocks a write", { kill: { snapshot: snap([], now - KILL_SNAPSHOT_MAX_AGE_MS - 1) } }, "block", "GOV-KILL-STALE"],
    ["null snapshot allows a read", { call: { effect: "read" }, kill: { snapshot: null } }, "allow", "GOV-ALLOW-READ"],
    ["expired switch does not match", { kill: { snapshot: snap([sw("stop", "agent", "a1", now)]) } }, "allow", "GOV-ALLOW"],
    ["other scope id does not match", { kill: { snapshot: snap([sw("stop", "agent", "a2")]) } }, "allow", "GOV-ALLOW"],
    ["platform switch matches any scopes", { kill: { snapshot: snap([sw("read_only", "platform", "*")]), scopes: {} } }, "block", "GOV-KILL-READ-ONLY"],
    ["audit down blocks a write", { policy: { auditAvailable: false } }, "block", "GOV-AUDIT-UNAVAILABLE"],
    ["audit down allows a read", { call: { effect: "read" }, policy: { auditAvailable: false } }, "allow", "GOV-ALLOW-READ"],
    ["secret in arguments", { call: { effect: "read", secretInArguments: true } }, "block", "GOV-SECRET-IN-ARGS"],
    ["decoy in arguments", { call: { decoyInArguments: true } }, "block", "GOV-DECOY-IN-ARGS"],
    ["governance action from a run", { call: { governanceAction: true } }, "block", "GOV-GOVERNANCE-FROM-RUN"],
    ["external send at high risk", { call: externalSend, conversation: { risk: "high" } }, "block", "GOV-EXFIL-EXTERNAL"],
    ["org block list", { call: { onOrgBlockList: true } }, "block", "GOV-TOOL-BLOCKLISTED"],
    ["grant deny", { policy: { grant: "deny" } }, "block", "GOV-GRANT-DENY"],
    ["hint deny", { policy: { permissionHint: "deny" } }, "block", "GOV-HINT-DENY"],
    ["private data send asks at risk none", { call: externalSend, conversation: { privateData: true } }, "ask", "GOV-PRIVATE-DATA-SEND"],
    ["private data send asks at elevated risk", { call: externalSend, conversation: { privateData: true, risk: "elevated" } }, "ask", "GOV-PRIVATE-DATA-SEND"],
    ["internal send ignores private data", { call: { effect: "send" }, conversation: { privateData: true } }, "allow", "GOV-ALLOW"],
    ["risk high asks a write", { conversation: { risk: "high" } }, "ask", "GOV-RISK-HIGH"],
    ["risk high allows a read", { call: { effect: "read" }, conversation: { risk: "high" } }, "allow", "GOV-ALLOW-READ"],
    ["risk elevated asks a publish", { call: { effect: "publish" }, conversation: { risk: "elevated" } }, "ask", "GOV-RISK-ELEVATED"],
    ["risk elevated allows a plain write", { conversation: { risk: "elevated" } }, "allow", "GOV-ALLOW"],
    ["pending verdicts raise risk none to elevated", { call: { effect: "delete" }, conversation: { pendingVerdicts: 1 } }, "ask", "GOV-RISK-ELEVATED"],
    ["critical tool blocks when judge is down", { call: { onCriticalList: true }, policy: { judgeAvailable: false } }, "block", "GOV-CRITICAL-TOOL-JUDGE-DOWN"],
    ["critical tool blocks when critic is unavailable", { call: { onCriticalList: true }, critic: { status: "unavailable" } }, "block", "GOV-CRITICAL-TOOL-JUDGE-DOWN"],
    ["critical tool read is fine with judge down", { call: { effect: "read", onCriticalList: true }, policy: { judgeAvailable: false } }, "allow", "GOV-ALLOW-READ"],
    ["critic high asks", { call: { effect: "execute" }, critic: { status: "decided", level: "high" } }, "ask", "GOV-CRITIC-HIGH"],
    ["critic critical blocks", { call: { effect: "execute" }, critic: { status: "decided", level: "critical" } }, "block", "GOV-CRITIC-CRITICAL"],
    ["critic critical asks in ask mode", { call: { effect: "execute" }, critic: { status: "decided", level: "critical" }, policy: { criticalBlockMode: "ask" } }, "ask", "GOV-CRITIC-CRITICAL"],
    ["grant ask", { policy: { grant: "ask" } }, "ask", "GOV-GRANT-ASK"],
    ["hint ask", { policy: { permissionHint: "ask" } }, "ask", "GOV-HINT-ASK"],
    ["allow a write", {}, "allow", "GOV-ALLOW"],
    ["allow a read", { call: { effect: "read" } }, "allow", "GOV-ALLOW-READ"],
    ["unknown effect is an external send", { call: { effect: "unknown" }, conversation: { privateData: true } }, "ask", "GOV-PRIVATE-DATA-SEND"],
    ["unknown effect asks at elevated risk", { call: { effect: "unknown" }, conversation: { risk: "elevated" } }, "ask", "GOV-RISK-ELEVATED"],
    ["invalid risk reads as high", { conversation: { risk: "bogus" as unknown as RiskLevel } }, "ask", "GOV-RISK-HIGH"],
    ["kill beats hard rule", { call: { secretInArguments: true }, kill: { snapshot: snap([sw("stop")]) } }, "block", "GOV-KILL-STOP"],
    ["secret still blocks under ask_all", { call: { secretInArguments: true }, kill: { snapshot: snap([sw("ask_all")]) } }, "block", "GOV-SECRET-IN-ARGS"],
    ["hard rule beats private data", { call: { ...externalSend, secretInArguments: true }, conversation: { privateData: true } }, "block", "GOV-SECRET-IN-ARGS"],
    ["deny beats ask", { policy: { grant: "ask", permissionHint: "deny" } }, "block", "GOV-HINT-DENY"],
    ["grant deny beats ask_all", { kill: { snapshot: snap([sw("ask_all")]) }, policy: { grant: "deny" } }, "block", "GOV-GRANT-DENY"],
    ["hint allow cannot loosen a grant ask", { policy: { grant: "ask", permissionHint: "allow" } }, "ask", "GOV-GRANT-ASK"],
    ["hint ask tightens an allow", { policy: { grant: "allow", permissionHint: "ask" } }, "ask", "GOV-HINT-ASK"],
    ["critic critical blocks at elevated risk too", { conversation: { risk: "elevated" }, critic: { status: "decided", level: "critical" } }, "block", "GOV-CRITIC-CRITICAL"],
    ["critic critical blocks under ask_all", { kill: { snapshot: snap([sw("ask_all")]) }, critic: { status: "decided", level: "critical" } }, "block", "GOV-CRITIC-CRITICAL"],
    ["web fetch at high risk is a blocked send", { call: { effect: "read", destination: { kind: "external" } }, conversation: { risk: "high" } }, "block", "GOV-EXFIL-EXTERNAL"],
    ["external read with private data asks", { call: { effect: "read", destination: { kind: "external" } }, conversation: { privateData: true } }, "ask", "GOV-PRIVATE-DATA-SEND"],
    ["unknown grant asks", { policy: { grant: "DENY" as Grant } }, "ask", "GOV-GRANT-ASK"],
    ["unknown switch mode stops", { kill: { snapshot: snap([{ ...sw("stop"), mode: "freeze" as KillMode }]) } }, "block", "GOV-KILL-STOP"],
    ["future-dated snapshot is stale", { kill: { snapshot: snap([], now + 60_000) } }, "block", "GOV-KILL-STALE"],
    ["garbage switches list is stale", { kill: { snapshot: { epoch: 1, takenAtMs: now, switches: "x" as unknown as KillSwitch[] } } }, "block", "GOV-KILL-STALE"],
  ];
  it.each(cases)("%s", (_name, patch, decision, reasonCode) => {
    const d = decide(input(patch));
    expect([d.decision, d.reasonCode, d.policyVersion]).toEqual([decision, reasonCode, POLICY_VERSION]);
    expect(d.reasonText.length).toBeGreaterThan(0);
  });

  it("names the switch that decided", () => {
    const stop = sw("stop");
    expect(decide(input({ kill: { snapshot: snap([stop]) } })).killSwitch).toBe(stop);
    expect(decide(input({ kill: { snapshot: null } })).killSwitch).toBeUndefined();
  });
});

describe("matchKillSwitches", () => {
  it("orders stop, read_only, ask_all and drops expired or foreign switches", () => {
    const [askAll, readOnly, stop] = [sw("ask_all", "platform", "*"), sw("read_only", "user", "u1"), sw("stop", "tool", "t1")];
    const switches = [askAll, sw("stop", "agent", "a1", now - 1), readOnly, sw("read_only", "org", "o2"), stop];
    expect(matchKillSwitches(snap(switches), { agent: "a1", user: "u1", tool: "t1", org: "o1" }, now)).toEqual([stop, readOnly, askAll]);
    expect(matchKillSwitches(null, { agent: "a1" }, now)).toEqual([]);
  });
});

function xorshift32(seed: number): () => number {
  let x = seed | 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}

describe("decide invariants", () => {
  const r = xorshift32(0xc0ffee);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const flag = (p: number) => r() < p;
  const EFFECTS: readonly string[] = [...EFFECT_CLASSES, "unknown", "bogus"];
  const RISKS: readonly string[] = ["none", "elevated", "high", "bogus"];
  const IDS = ["a1", "a2", "*"] as const;
  const GRANTS = ["allow", "ask", "deny"] as const;

  it("holds over 3000 random inputs", () => {
    for (let i = 0; i < 3000; i++) {
      const nowMs = now + Math.floor(r() * 24_000) - 2_000;
      const switches: KillSwitch[] = Array.from({ length: Math.floor(r() * 4) }, () => ({
        scopeKind: pick(KILL_SCOPE_KINDS),
        scopeId: pick(IDS),
        mode: pick(["stop", "read_only", "ask_all"] as const),
        epoch: 1,
        ...(flag(0.3) ? { expiresAtMs: nowMs + Math.floor(r() * 2_000) - 1_000 } : {}),
      }));
      const snapshot = flag(0.1) ? null : snap(switches);
      const scopes = Object.fromEntries(KILL_SCOPE_KINDS.filter(() => flag(0.5)).map((k) => [k, pick(IDS)])) as CallScopes;
      const call: CallFacts = {
        toolName: "t",
        effect: pick(EFFECTS) as CallFacts["effect"],
        destination: { kind: pick(["internal", "external", "untrusted_mcp", "unknown"] as const) },
        secretInArguments: flag(0.1),
        decoyInArguments: flag(0.1),
        governanceAction: flag(0.1),
        onOrgBlockList: flag(0.1),
        onCriticalList: flag(0.3),
      };
      const policy: PolicyInput = {
        judgeAvailable: flag(0.8),
        auditAvailable: flag(0.9),
        criticalBlockMode: pick(["block", "ask"] as const),
        ...(flag(0.7) ? { grant: pick(GRANTS) } : {}),
        ...(flag(0.7) ? { permissionHint: pick(GRANTS) } : {}),
      };
      const critic: CriticVerdict = { status: pick(["not_needed", "unavailable", "decided"] as const), level: pick(["low", "medium", "high", "critical"] as const) };
      const d = decide({
        call,
        kill: { snapshot, scopes, nowMs },
        conversation: { risk: pick(RISKS) as RiskLevel, privateData: flag(0.3), pendingVerdicts: Math.floor(r() * 4) - 1, readUntypedContent: flag(0.5) },
        critic,
        policy,
      });

      expect(["allow", "ask", "block"]).toContain(d.decision);
      expect(isReasonCode(d.reasonCode)).toBe(true);
      const live = (snapshot?.switches ?? []).filter(
        (s) => !(s.expiresAtMs !== undefined && s.expiresAtMs <= nowMs) && (s.scopeKind === "platform" || scopes[s.scopeKind] === s.scopeId),
      );
      const sideEffect = call.effect !== "read";
      const age = nowMs - (snapshot?.takenAtMs ?? Number.NaN);
      const stale = !(age >= 0 && age <= KILL_SNAPSHOT_MAX_AGE_MS);
      if (live.some((s) => s.mode === "stop")) expect(d.decision).not.toBe("allow");
      if (sideEffect && (live.length > 0 || stale)) expect(d.decision).not.toBe("allow");
      if (call.secretInArguments) expect(d.decision).toBe("block");
      if (sideEffect && critic.status === "decided" && critic.level === "critical" && policy.criticalBlockMode === "block") expect(d.decision).toBe("block");
      const hard = call.secretInArguments || call.decoyInArguments || call.governanceAction || call.onOrgBlockList;
      if (!sideEffect && call.destination.kind === "internal" && live.length === 0 && !hard && policy.grant !== "deny" && policy.permissionHint !== "deny") {
        expect(d.decision).not.toBe("block");
        if (d.decision === "ask") expect([policy.grant, policy.permissionHint]).toContain("ask");
      }
    }
  });
});
