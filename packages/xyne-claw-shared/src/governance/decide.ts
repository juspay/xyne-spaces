import { reasonText, type ReasonCode } from "./reason-codes.js";
import {
  EFFECT_CLASSES,
  isSideEffect,
  KILL_SNAPSHOT_MAX_AGE_MS,
  POLICY_VERSION,
  type CallScopes,
  type DecideInput,
  type Decision,
  type DecisionKind,
  type EffectClass,
  type Grant,
  type KillMode,
  type KillSnapshot,
  type KillSwitch,
  type RiskLevel,
} from "./types.js";

const KILL_MODES: readonly KillMode[] = ["stop", "read_only", "ask_all"];
const RISK_LEVELS: readonly RiskLevel[] = ["none", "elevated", "high"];
const GRANTS: readonly Grant[] = ["allow", "ask", "deny"];
const ASKS_AT_ELEVATED: ReadonlySet<EffectClass | "unknown"> = new Set([
  "publish",
  "send",
  "delete",
  "execute",
  "persist",
  "admin",
  "unknown",
]);

type Row = readonly [matches: boolean, decision: DecisionKind, code: ReasonCode, killSwitch?: KillSwitch | undefined];

function decided(decision: DecisionKind, reasonCode: ReasonCode, killSwitch?: KillSwitch): Decision {
  return {
    decision,
    reasonCode,
    reasonText: reasonText(reasonCode),
    policyVersion: POLICY_VERSION,
    ...(killSwitch ? { killSwitch } : {}),
  };
}

// An unknown mode on a matching switch ranks as stop: it can tighten, never loosen.
const rank = (s: KillSwitch): number => Math.max(0, KILL_MODES.indexOf(s.mode));

export function matchKillSwitches(snapshot: KillSnapshot | null, scopes: CallScopes, nowMs: number): KillSwitch[] {
  const all: readonly KillSwitch[] = Array.isArray(snapshot?.switches) ? snapshot.switches : [];
  return all
    .filter(
      (s) =>
        s &&
        !(typeof s.expiresAtMs === "number" && s.expiresAtMs <= nowMs) &&
        (s.scopeKind === "platform" || (typeof s.scopeId === "string" && scopes?.[s.scopeKind] === s.scopeId)),
    )
    .sort((a, b) => rank(a) - rank(b));
}

const grantOf = (value: Grant | undefined): Grant | undefined => (value === undefined ? undefined : GRANTS.includes(value) ? value : "ask");

export function decide(input: DecideInput): Decision {
  const { call, kill, conversation, critic, policy } = input ?? ({} as DecideInput);
  const rawEffect = call?.effect;
  const effect: EffectClass | "unknown" = (EFFECT_CLASSES as readonly string[]).includes(rawEffect) ? rawEffect : "unknown";
  const sideEffect = isSideEffect(effect);
  // Any call whose arguments leave the org is a send, web fetches included; an unclassified tool counts as one.
  const sendsOutside = effect === "unknown" || call?.destination?.kind !== "internal";

  let risk: RiskLevel = RISK_LEVELS.includes(conversation?.risk) ? conversation.risk : "high";
  const pending = conversation?.pendingVerdicts;
  if (risk === "none" && !(typeof pending === "number" && pending <= 0)) risk = "elevated";

  const snapshot = Array.isArray(kill?.snapshot?.switches) ? kill.snapshot : null;
  const nowMs = Number(kill?.nowMs);
  const top = matchKillSwitches(snapshot, kill?.scopes ?? {}, nowMs)[0];
  const mode = top ? KILL_MODES[rank(top)] : undefined;
  const age = nowMs - Number(snapshot?.takenAtMs);
  const stale = !(age >= 0 && age <= KILL_SNAPSHOT_MAX_AGE_MS);

  const judgeDown = policy?.judgeAvailable !== true || critic?.status === "unavailable";
  const level = critic?.status === "decided" ? critic.level : undefined;
  const grant = grantOf(policy?.grant);
  const hint = grantOf(policy?.permissionHint);

  // Top-down, every block above every ask, so a switch or a hint tightens a decision but never loosens one.
  const rows: readonly Row[] = [
    [mode === "stop", "block", "GOV-KILL-STOP", top],
    [mode === "read_only" && sideEffect, "block", "GOV-KILL-READ-ONLY", top],
    [stale && sideEffect, "block", "GOV-KILL-STALE"],
    [policy?.auditAvailable === false && sideEffect, "block", "GOV-AUDIT-UNAVAILABLE"],
    [!!call?.secretInArguments, "block", "GOV-SECRET-IN-ARGS"],
    [!!call?.decoyInArguments, "block", "GOV-DECOY-IN-ARGS"],
    [!!call?.governanceAction, "block", "GOV-GOVERNANCE-FROM-RUN"],
    [sendsOutside && risk === "high", "block", "GOV-EXFIL-EXTERNAL"],
    [!!call?.onOrgBlockList, "block", "GOV-TOOL-BLOCKLISTED"],
    [grant === "deny", "block", "GOV-GRANT-DENY"],
    [hint === "deny", "block", "GOV-HINT-DENY"],
    [!!call?.onCriticalList && sideEffect && judgeDown, "block", "GOV-CRITICAL-TOOL-JUDGE-DOWN"],
    [sideEffect && level === "critical" && policy?.criticalBlockMode !== "ask", "block", "GOV-CRITIC-CRITICAL"],
    [mode === "ask_all" && sideEffect, "ask", "GOV-KILL-ASK-ALL", top],
    [sendsOutside && !!conversation?.privateData, "ask", "GOV-PRIVATE-DATA-SEND"],
    [risk === "high" && sideEffect, "ask", "GOV-RISK-HIGH"],
    [risk === "elevated" && ASKS_AT_ELEVATED.has(effect), "ask", "GOV-RISK-ELEVATED"],
    [sideEffect && level === "high", "ask", "GOV-CRITIC-HIGH"],
    [sideEffect && level === "critical", "ask", "GOV-CRITIC-CRITICAL"],
    [grant === "ask", "ask", "GOV-GRANT-ASK"],
    [hint === "ask", "ask", "GOV-HINT-ASK"],
  ];
  for (const [matches, decision, code, killSwitch] of rows) if (matches) return decided(decision, code, killSwitch);
  return decided("allow", sideEffect ? "GOV-ALLOW" : "GOV-ALLOW-READ");
}
