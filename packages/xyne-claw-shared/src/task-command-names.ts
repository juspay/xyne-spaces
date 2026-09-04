export const TASK_COMMAND_NAMES = ["explainer", "record-skill", "design", "dashboard", "spec"] as const;

export type TaskCommandName = (typeof TASK_COMMAND_NAMES)[number];

export const IMMEDIATE_TASK_COMMAND_RE = new RegExp(`^\\/(?:${TASK_COMMAND_NAMES.join("|")})(?:\\s|$)`, "i");

export const RECORD_SKILL_COMMAND_RE = /^\/record-skill(?:\s|$)/i;
