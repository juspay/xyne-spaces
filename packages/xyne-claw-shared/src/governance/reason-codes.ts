export const REASON_CODES = {
  "GOV-ALLOW": "Allowed and recorded.",
  "GOV-ALLOW-READ": "A read, allowed and recorded.",
  "GOV-KILL-STOP": "A kill switch has stopped this scope; nothing runs until an admin resumes it.",
  "GOV-KILL-READ-ONLY": "A read-only kill switch is set for this scope; only read calls run.",
  "GOV-KILL-ASK-ALL": "An ask-all kill switch is set for this scope; every call except a read needs approval.",
  "GOV-KILL-STALE": "The kill-switch snapshot is older than 10 seconds, so side effects are refused until it refreshes.",
  "GOV-SECRET-IN-ARGS": "The call's arguments contain a secret, so it is blocked.",
  "GOV-DECOY-IN-ARGS": "The call's arguments contain a decoy credential that only an attacker would use, so it is blocked.",
  "GOV-GOVERNANCE-FROM-RUN": "A run tried to change governance settings, which only an admin may do outside a run.",
  "GOV-TOOL-BLOCKLISTED": "This tool is on the org's block list.",
  "GOV-EXFIL-EXTERNAL":
    "This run read content flagged as a possible injection, and the call sends data to an external address. Do not retry; tell the user.",
  "GOV-PRIVATE-DATA-SEND": "The conversation holds private data and this call sends outside the org, so a person must approve it.",
  "GOV-RISK-HIGH": "Conversation risk is high, so every call except a read needs approval.",
  "GOV-RISK-ELEVATED": "Conversation risk is elevated, so publish, send, delete, execute, persist and admin calls need approval.",
  "GOV-CRITICAL-TOOL-JUDGE-DOWN": "This tool is on the critical list and the judge is unavailable, so the call is refused.",
  "GOV-CRITIC-HIGH": "The tool-risk critic rated this call high, so it needs approval.",
  "GOV-CRITIC-CRITICAL": "The tool-risk critic rated this call critical.",
  "GOV-GRANT-DENY": "The agent's grant denies this tool.",
  "GOV-GRANT-ASK": "The agent's grant for this tool requires approval.",
  "GOV-HINT-DENY": "The caller refused this call.",
  "GOV-HINT-ASK": "The caller asked for approval on this call.",
  "GOV-UNCLASSIFIED-TOOL": "This tool has no effect classification, so it counts as an external send and a write.",
  "GOV-AUDIT-UNAVAILABLE": "The audit log cannot be written, so side-effect calls are refused.",
  "GOV-HIDDEN-PAYLOAD": "Hidden characters decode to text, which only an attack does.",
  "GOV-INVISIBLE-TEXT": "The text contains characters that hide text from people.",
  "GOV-SECRET-IN-CONTENT": "The text contains a credential.",
  "GOV-ROLE-FORGERY": "The text imitates a chat template or a system role.",
  "GOV-FRAMEWORK-IMITATION": "The text imitates this framework's own notices.",
  "GOV-EXFIL-PATTERN": "The text would send data to an outside address.",
  "GOV-FAKE-TOOL-MARKUP": "The text contains fake tool-call markup or an instruction block aimed at the model.",
  "GOV-JUDGE-ADDRESSED": "The text speaks to a reviewer or classifier instead of a person.",
  "GOV-SENSITIVE-PATH": "The text names a credential or secret file location.",
  "GOV-CONCEALMENT": "The text asks the agent to hide something from the user.",
  "GOV-PERSISTENCE": "The text asks the agent to change its memory or standing instructions.",
  "GOV-TOOL-POISONING": "The tool description claims side effects a tool should not have, or imitates another tool's name.",
  "GOV-INSTRUCTION-OVERRIDE": "The text tells the agent to ignore its instructions.",
  "GOV-RUNTIME-FETCH": "The skill fetches instructions or code at run time, or rewrites its own files.",
  "GOV-SHELL-PIPE": "A download is piped straight into a shell.",
  "GOV-EVAL-DECODED": "Decoded or built-up data is executed.",
  "GOV-ENCODED-BLOB": "The text carries an encoded blob that decodes to readable text.",
  "GOV-BINARY-ARTIFACT": "The bundle contains a binary or an archive.",
  "GOV-UNVERIFIED": "A check could not finish in time, so the content counts as unverified.",
  "GOV-JUDGE-SUSPICIOUS": "The judge found instructions aimed at the agent.",
  "GOV-JUDGE-INJECTION": "The judge found an injection and quoted it.",
  "GOV-JUDGE-CONTROL-FAILED": "The judge mislabelled a control chunk, so its answers for this batch were discarded.",
  "GOV-JUDGE-QUOTE-INVALID": "The judge quoted text that is not in the chunk, so its answer was discarded.",
  "GOV-HASH-UNAPPROVED": "This content's hash is not approved, so the last approved version is used.",
  "GOV-VERSION-PENDING": "This version is waiting for its checks or an approval.",
  "GOV-VERSION-REJECTED": "This version was rejected.",
  "GOV-VERSION-HELD": "This version is held after a rescan and waits for its owner.",
  "GOV-ADMIN-OVERRIDE": "An admin approved this with a written reason; it is audited and alerted.",
} as const;

export type ReasonCode = keyof typeof REASON_CODES;

export function reasonText(code: ReasonCode): string {
  return REASON_CODES[code];
}

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REASON_CODES, value);
}
