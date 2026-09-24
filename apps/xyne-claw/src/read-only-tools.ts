import { classifyToolRisk } from "xyne-claw-shared";

const SIDE_EFFECT_TOKENS = new Set([
  "mutate", "trigger", "fork", "run", "rerun", "execute", "exec", "start", "stop", "restart", "deploy",
  "dispatch", "invoke", "sync", "import", "enable", "disable", "toggle", "close", "reopen", "transfer",
  "grant", "resolve", "submit", "book", "pay", "refund", "charge", "notify", "provision", "rotate",
  "reset", "apply", "kick", "clone", "lock", "unlock", "pin", "unpin", "react", "vote", "subscribe",
  "unsubscribe", "follow", "unfollow", "mark", "snooze", "mute", "unmute", "join", "leave", "tag", "label",
]);

export function looksReadOnly(toolName: string, declaredWrite?: boolean): boolean {
  if (declaredWrite) return false;
  if (classifyToolRisk(toolName) !== "read") return false;
  const bare = toolName.split("__").pop() ?? toolName;
  return !bare.toLowerCase().split(/[^a-z0-9]+/).some((token) => SIDE_EFFECT_TOKENS.has(token));
}
