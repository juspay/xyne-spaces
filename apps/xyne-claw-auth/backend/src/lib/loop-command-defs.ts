import type { ExperimentRun, LoopCommandDefinition } from "@prisma/client";
import { findCommand } from "@xyne/shared/commands";
import {
  LOOP_COMMANDS,
  LOOP_SKILL_BUNDLE_IDS,
  SUBAGENT_DEFINITIONS,
  buildCustomLoopDef,
  getLoopTemplate,
  MAX_SEQUENCE_STEPS,
  MIN_SEQUENCE_STEPS,
  type LoopCommandDef,
  type LoopSequenceStep,
  type LoopTemplateId,
} from "xyne-claw-shared";
import { prisma } from "../db.js";
import { EXPERIMENT_PROVIDERS } from "./experiment.js";

export class LoopCommandValidationError extends Error {
  constructor(public field: string, public detail: string) {
    super(`${field}: ${detail}`);
  }
}

const NAME_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const MODEL_RE = /^[a-zA-Z0-9._:/-]{1,100}$/;
const SKILL_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SUBAGENT_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const RESERVED = new Set(["help", "stop", "status", "goal", "experiment", "eval", "debug", "fast", "clear", "compact", "queue", "loop", "loops"]);

export interface LoopCommandInput {
  name?: unknown;
  description?: unknown;
  template?: unknown;
  instruction?: unknown;
  skills?: unknown;
  subagents?: unknown;
  provider?: unknown;
  modelId?: unknown;
  maxDurationMinutes?: unknown;
  maxPasses?: unknown;
  deliverable?: unknown;
  judgeQuestion?: unknown;
  steps?: unknown;
}

export interface ValidatedLoopCommand {
  name: string;
  description: string;
  template: LoopTemplateId;
  instruction: string;
  skills: string[];
  subagents: string[];
  provider: string | null;
  modelId: string | null;
  maxDurationMinutes: number;
  maxPasses: number | null;
  deliverable: "md" | "html" | null;
  judgeQuestion: string | null;
  steps: LoopSequenceStep[] | null;
}

const STEP_COMMAND_RE = /^\/[a-z][a-z0-9-]{1,40}$/;

function validateSteps(raw: unknown, selfName: string): LoopSequenceStep[] {
  if (!Array.isArray(raw) || raw.length < MIN_SEQUENCE_STEPS || raw.length > MAX_SEQUENCE_STEPS) {
    throw new LoopCommandValidationError("steps", `a sequence needs ${MIN_SEQUENCE_STEPS}–${MAX_SEQUENCE_STEPS} steps`);
  }
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const command = typeof o["command"] === "string" ? o["command"].trim().toLowerCase() : "";
    const args = typeof o["args"] === "string" ? o["args"].trim() : "";
    if (!STEP_COMMAND_RE.test(command)) throw new LoopCommandValidationError(`steps[${i}].command`, "must be a loop command like /ui-test");
    if (command === `/${selfName}`) throw new LoopCommandValidationError(`steps[${i}].command`, "a sequence cannot run itself");
    if (args.length > 300) throw new LoopCommandValidationError(`steps[${i}].args`, "at most 300 characters");
    return { command, args };
  });
}

export async function checkSequenceSteps(orgId: string, steps: LoopSequenceStep[]): Promise<void> {
  const builtin = new Set(LOOP_COMMANDS.map((d) => d.command));
  const customNames = steps.map((s) => s.command.slice(1)).filter((n) => !builtin.has(`/${n}`));
  const rows = customNames.length
    ? await prisma.loopCommandDefinition.findMany({ where: { orgId, name: { in: customNames } }, select: { name: true, template: true } })
    : [];
  steps.forEach((step, i) => {
    if (builtin.has(step.command)) return;
    const row = rows.find((r) => r.name === step.command.slice(1));
    if (!row) throw new LoopCommandValidationError(`steps[${i}].command`, `${step.command} is not a loop command in this org`);
    if (getLoopTemplate(row.template)?.composite) throw new LoopCommandValidationError(`steps[${i}].command`, `${step.command} is itself a sequence; sequences cannot nest`);
  });
}

function str(v: unknown, field: string, min: number, max: number): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min || s.length > max) throw new LoopCommandValidationError(field, `must be ${min}–${max} characters`);
  return s;
}

function list(v: unknown, field: string, re: RegExp, max: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new LoopCommandValidationError(field, "must be a list");
  const out = [...new Set(v.map((x) => (typeof x === "string" ? x.trim() : "")))];
  if (out.length > max) throw new LoopCommandValidationError(field, `at most ${max}`);
  for (const x of out) if (!re.test(x)) throw new LoopCommandValidationError(field, `"${x}" is not a valid name`);
  return out;
}

function bundles(skills: string[]): string[] {
  const bad = skills.find((x) => !LOOP_SKILL_BUNDLE_IDS.has(x));
  if (bad) throw new LoopCommandValidationError("skills", `"${bad}" is not a skill bundle; use ${[...LOOP_SKILL_BUNDLE_IDS].join(", ")}`);
  return skills;
}

export function isReservedCommandName(name: string): boolean {
  return RESERVED.has(name) || Boolean(findCommand(`/${name}`)) || LOOP_COMMANDS.some((d) => d.command === `/${name}`);
}

export function validateLoopCommand(input: LoopCommandInput, opts: { requireName: boolean }): ValidatedLoopCommand {
  const name = typeof input.name === "string" ? input.name.trim().toLowerCase() : "";
  if (opts.requireName && !NAME_RE.test(name)) {
    throw new LoopCommandValidationError("name", "use 3–32 lowercase letters, digits and hyphens, starting with a letter");
  }
  if (opts.requireName && isReservedCommandName(name)) throw new LoopCommandValidationError("name", `/${name} is already a built-in command`);
  const template = getLoopTemplate(typeof input.template === "string" ? input.template : "");
  if (!template) throw new LoopCommandValidationError("template", "pick one of the templates");
  if (template.composite) {
    return {
      name,
      description: str(input.description, "description", 3, 300),
      template: template.id,
      instruction: "",
      skills: [],
      subagents: [],
      provider: null,
      modelId: null,
      maxDurationMinutes: template.defaultDurationMin,
      maxPasses: null,
      deliverable: null,
      judgeQuestion: null,
      steps: validateSteps(input.steps, name || String(input.name ?? "")),
    };
  }
  const maxDurationMinutes =
    input.maxDurationMinutes === undefined || input.maxDurationMinutes === null ? template.defaultDurationMin : Number(input.maxDurationMinutes);
  if (!Number.isInteger(maxDurationMinutes) || maxDurationMinutes < 5 || maxDurationMinutes > template.maxDurationMin) {
    throw new LoopCommandValidationError("maxDurationMinutes", `must be a whole number of minutes, 5–${template.maxDurationMin}`);
  }
  const maxPasses = input.maxPasses === undefined || input.maxPasses === null || input.maxPasses === "" ? null : Number(input.maxPasses);
  if (maxPasses !== null && (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 50)) {
    throw new LoopCommandValidationError("maxPasses", "must be a whole number, 1–50");
  }
  const deliverable = input.deliverable === "md" || input.deliverable === "html" ? input.deliverable : null;
  if (template.deliverable === "required" && !deliverable) throw new LoopCommandValidationError("deliverable", `the ${template.title} template needs a deliverable: md or html`);
  const judgeQuestion = typeof input.judgeQuestion === "string" && input.judgeQuestion.trim() ? input.judgeQuestion.trim() : null;
  if (template.question && (!judgeQuestion || judgeQuestion.length < 10 || judgeQuestion.length > 400)) {
    throw new LoopCommandValidationError("judgeQuestion", `${template.question.label}: write one yes/no question, 10–400 characters`);
  }
  const provider = typeof input.provider === "string" && input.provider.trim() ? input.provider.trim() : null;
  if (provider && !EXPERIMENT_PROVIDERS.has(provider)) throw new LoopCommandValidationError("provider", `must be one of ${[...EXPERIMENT_PROVIDERS].join(", ")}`);
  const modelId = typeof input.modelId === "string" && input.modelId.trim() ? input.modelId.trim() : null;
  if (modelId && !MODEL_RE.test(modelId)) throw new LoopCommandValidationError("modelId", "is not a valid model id");
  return {
    name,
    description: str(input.description, "description", 3, 300),
    template: template.id,
    instruction: str(input.instruction, "instruction", 20, 8_000),
    skills: bundles(list(input.skills, "skills", SKILL_RE, 10)),
    subagents: list(input.subagents, "subagents", SUBAGENT_RE, 8),
    provider,
    modelId,
    maxDurationMinutes,
    maxPasses,
    deliverable,
    judgeQuestion: template.question ? judgeQuestion : null,
    steps: null,
  };
}

export function toLoopDef(row: Pick<LoopCommandDefinition, "id" | "name" | "description" | "template" | "instruction" | "skills" | "subagents" | "deliverable" | "judgeQuestion" | "maxPasses">): LoopCommandDef {
  return buildCustomLoopDef({
    id: row.id,
    name: row.name,
    description: row.description,
    template: row.template as LoopTemplateId,
    instruction: row.instruction,
    skills: row.skills,
    subagents: row.subagents,
    deliverable: row.deliverable === "md" || row.deliverable === "html" ? row.deliverable : null,
    judgeQuestion: row.judgeQuestion,
    maxPasses: row.maxPasses,
  });
}

export function canRunLoopCommand(row: Pick<LoopCommandDefinition, "enabled" | "published" | "createdByUserId">, userId: string): boolean {
  return row.enabled && (row.published || row.createdByUserId === userId);
}

export async function findRunnableLoopCommand(orgId: string, userId: string, word: string): Promise<LoopCommandDefinition | null> {
  const name = word.replace(/^\//, "").toLowerCase();
  if (!NAME_RE.test(name) || isReservedCommandName(name)) return null;
  const row = await prisma.loopCommandDefinition.findUnique({ where: { orgId_name: { orgId, name } } });
  return row && canRunLoopCommand(row, userId) ? row : null;
}

export async function listRunnableLoopCommands(orgId: string, userId: string): Promise<LoopCommandDefinition[]> {
  return prisma.loopCommandDefinition.findMany({
    where: { orgId, enabled: true, OR: [{ published: true }, { createdByUserId: userId }] },
    orderBy: { name: "asc" },
    take: 100,
  });
}

const defCache = new Map<string, { at: Date; def: LoopCommandDef }>();

export async function loopDefForRun(run: Pick<ExperimentRun, "kind" | "commandId">): Promise<LoopCommandDef | null> {
  if (run.kind !== "custom" || !run.commandId) return null;
  const row = await prisma.loopCommandDefinition.findUnique({ where: { id: run.commandId } });
  if (!row) return null;
  const hit = defCache.get(row.id);
  if (hit && hit.at.getTime() === row.updatedAt.getTime()) return hit.def;
  const def = toLoopDef(row);
  defCache.set(row.id, { at: row.updatedAt, def });
  return def;
}

export function knownSubagentNames(customNames: string[]): Set<string> {
  return new Set([...SUBAGENT_DEFINITIONS.map((d) => d.name), ...customNames]);
}
