/**
 * One streamed draft turn.
 *
 *   t0  classify (small JSON) ─────────┐
 *       capability judge (speculative) ├─► identity, permission, schedule
 *                                      │   as soon as classify returns (~1s)
 *       instructions stream ◄──────────┘   start when the judge lands, or
 *                                          2s after classify, whichever is first
 *
 * The judge starts with classify because it only needs the user's message, not
 * classify's answer, and most turns need both. A turn that turns out to be a
 * question or small talk cancels it. Picks that land after the instructions
 * have started are appended as a "When to use each tool" section, so the
 * instructions still describe the tools the canvas ended up with.
 */
import type {
  AgentDraftBody,
  AgentPermissionMode,
  ClawDraftRequest,
  DraftHub,
  DraftPick,
  DraftTimings,
} from "xyne-claw-shared";
import { AuthoringLlmError } from "./authoring-llm.js";
import { classifyTurn, slugFromName, type ClassifyDecision } from "./classify.js";
import { judgeCapabilities, type JudgeInput, type JudgedCapabilities } from "./judge.js";
import {
  finishInstructions,
  streamInstructions,
  templateInstructions,
  toolsSection,
  type InstructionsInput,
  type InstructionsResult,
} from "./instructions.js";

export interface DraftDeps {
  classify: (input: ClawDraftRequest, signal: AbortSignal) => Promise<ClassifyDecision>;
  judge: (input: JudgeInput, signal: AbortSignal) => Promise<JudgedCapabilities>;
  instructions: (
    input: InstructionsInput,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ) => Promise<InstructionsResult>;
  now: () => number;
}

export const DEFAULT_DRAFT_DEPS: DraftDeps = {
  classify: classifyTurn,
  judge: judgeCapabilities,
  instructions: streamInstructions,
  now: Date.now,
};

/** How long instructions wait for the judge after classify returns. */
export const CAPABILITY_WAIT_MS = 2_000;
/** Hard cap on a whole turn. */
export const TURN_TIMEOUT_MS = 40_000;

const ALL_HUBS: readonly DraftHub[] = ["mcp", "builtin", "subagent", "skill", "knowledge"];
const TOOL_HUBS = new Set<DraftHub>(["mcp", "builtin", "subagent"]);
const VAGUE_CREATE = /^\s*(make|create|build)\s+(me\s+)?(an?\s+)?(agent|bot)\s*[.!?]*\s*$/i;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Replace a `## heading` section (up to the next `## `) or append it. */
export function replaceSection(text: string, heading: string, markdown: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)## ${escaped}[^\\n]*\\n[\\s\\S]*?(?=\\n## |$)`, "i");
  if (re.test(text)) return text.replace(re, (_m, lead: string) => `${lead}${markdown}`);
  return `${text.trimEnd()}\n\n${markdown}`;
}

function fallbackDecision(input: ClawDraftRequest): ClassifyDecision {
  const canvasEmpty = !input.canvas.name.trim() && !input.canvas.instructions.trim();
  const message = input.message.trim();
  if (canvasEmpty && (message.length < 12 || VAGUE_CREATE.test(message))) {
    return {
      mode: "ask",
      reply: "What job should this agent do for you?",
      fields: [],
      capabilityQuery: message,
      capabilityAdds: [],
      capabilityRemovals: [],
      instructionsBrief: message,
      ack: "",
    };
  }
  const words = message.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "New Agent";
  return {
    mode: canvasEmpty ? "draft" : "edit",
    reply: "",
    fields: canvasEmpty
      ? ["name", "handle", "description", "instructions", "tools", "skills", "knowledge", "permission"]
      : ["instructions"],
    ...(canvasEmpty ? { name, handle: slugFromName(name), description: message.slice(0, 140) } : {}),
    permission: { mode: "ask-first", reason: "Default until you choose." },
    capabilityQuery: message,
    capabilityAdds: [],
    capabilityRemovals: [],
    instructionsBrief: message,
    ack: canvasEmpty ? `Drafted ${name}.` : "Updated the instructions.",
  };
}

export async function runDraftTurn(
  input: ClawDraftRequest,
  emitBody: (body: AgentDraftBody) => void,
  signal: AbortSignal,
  deps: DraftDeps = DEFAULT_DRAFT_DEPS,
): Promise<void> {
  const t0 = deps.now();
  const turnSignal = AbortSignal.any([signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
  const judgeAbort = new AbortController();
  const judgeSignal = AbortSignal.any([turnSignal, judgeAbort.signal]);
  const timings: DraftTimings = { totalMs: 0 };
  let partial = false;
  const elapsed = (): number => deps.now() - t0;
  const emit = (body: AgentDraftBody): void => {
    if (
      timings.firstFieldMs === undefined &&
      (body.event === "identity" ||
        body.event === "permission" ||
        body.event === "schedule" ||
        body.event === "instructions.delta" ||
        body.event === "capabilities")
    ) {
      timings.firstFieldMs = elapsed();
    }
    emitBody(body);
  };
  const warn = (stage: string, message: string): void => {
    partial = true;
    emit({ event: "warning", stage, message });
  };
  const finish = (status: "completed" | "partial" | "cancelled"): void => {
    timings.totalMs = elapsed();
    emit({ event: "done", status, timings });
  };

  emit({ event: "started", draftId: input.draftId });

  const owned = new Set(input.userOwned);
  const wantedHubs = ALL_HUBS.filter((hub) =>
    hub === "skill" ? !owned.has("skills") : hub === "knowledge" ? !owned.has("knowledge") : !owned.has("tools"),
  );
  const onCanvas = new Set(input.canvas.capabilities.map((c) => `${c.hub}:${c.id}`));

  try {
    // Start the judge with classify: it only needs the message.
    const judgeIntent = input.message.trim();
    const judgeWanted = wantedHubs.length > 0 && !VAGUE_CREATE.test(judgeIntent) && judgeIntent.length >= 8;
    const judgePromise: Promise<JudgedCapabilities | null> = judgeWanted
      ? deps
          .judge(
            {
              intent: judgeIntent,
              catalog: input.catalog,
              skills: input.skillCandidates,
              knowledge: input.knowledgeCandidates,
              hubs: wantedHubs,
            },
            judgeSignal,
          )
          .catch((err: unknown) => {
            if (!(err instanceof AuthoringLlmError && err.kind === "aborted")) {
              warn("capabilities", "Couldn't pick tools automatically. You can add them from the canvas.");
            }
            return null;
          })
      : Promise.resolve(null);

    let decision: ClassifyDecision;
    try {
      decision = await deps.classify(input, turnSignal);
    } catch (err) {
      if (turnSignal.aborted) throw err;
      warn("classify", "Couldn't plan the draft, so I used a simple one.");
      decision = fallbackDecision(input);
    }

    emit({ event: "mode", mode: decision.mode, fields: decision.fields });

    if (decision.mode === "ask" || decision.mode === "chat") {
      judgeAbort.abort();
      emit({
        event: "reply.delta",
        text: decision.reply || (decision.mode === "ask" ? "What job should this agent do for you?" : "Tell me what you want to change."),
      });
      finish(partial ? "partial" : "completed");
      return;
    }

    // classify already skips user-owned fields; enforce it here too so a model slip
    // can never overwrite something the user is editing.
    const fields = new Set(decision.fields.filter((f) => !owned.has(f)));
    const newName = fields.has("name") ? decision.name : undefined;
    const newHandle = fields.has("handle") ? decision.handle : undefined;
    const newDescription = fields.has("description") ? decision.description : undefined;
    const permissionMode: AgentPermissionMode =
      decision.permission && fields.has("permission") ? decision.permission.mode : input.canvas.permissionMode;
    const name = newName ?? input.canvas.name;
    const description = newDescription ?? input.canvas.description;

    // Small fields land first.
    if (newName || newHandle || newDescription) {
      emit({ event: "field.start", field: newName ? "name" : newHandle ? "handle" : "description" });
      emit({
        event: "identity",
        ...(newName ? { name: newName } : {}),
        ...(newHandle ? { handle: newHandle } : {}),
        ...(newDescription ? { description: newDescription } : {}),
      });
    }
    if (decision.permission && fields.has("permission")) {
      emit({ event: "permission", mode: decision.permission.mode, reason: decision.permission.reason });
    }
    if (decision.schedule === "clear") {
      emit({ event: "schedule", op: "clear" });
    } else if (decision.schedule && fields.has("schedule")) {
      emit({
        event: "schedule",
        op: "set",
        cron: decision.schedule.cron,
        timezone: input.timezone,
        label: decision.schedule.label,
        task: decision.schedule.task,
      });
    }

    // Capabilities: removals need no model call; additions use the judge.
    const removals = decision.capabilityRemovals.filter((r) =>
      r.hub === "skill" ? !owned.has("skills") : r.hub === "knowledge" ? !owned.has("knowledge") : !owned.has("tools"),
    );
    const wantsCaps =
      decision.mode === "draft" ||
      fields.has("tools") ||
      fields.has("skills") ||
      fields.has("knowledge") ||
      decision.capabilityAdds.length > 0;
    if (!wantsCaps) judgeAbort.abort();

    const sendCapabilities = (judged: JudgedCapabilities | null): DraftPick[] => {
      const keep = (pick: DraftPick): boolean => !onCanvas.has(`${pick.hub}:${pick.id}`);
      const readOnly = permissionMode === "read-only";
      const shape = (pick: DraftPick): DraftPick =>
        readOnly && pick.hub === "mcp" ? { ...pick, access: "read" } : pick;
      const bound = (judged?.bound ?? []).filter(keep).map(shape);
      const suggested = (judged?.suggested ?? []).filter(keep).map(shape);
      if (bound.length === 0 && suggested.length === 0 && removals.length === 0) return [];
      const firstHub = [...bound, ...suggested][0]?.hub;
      emit({ event: "field.start", field: firstHub && !TOOL_HUBS.has(firstHub) ? (firstHub === "skill" ? "skills" : "knowledge") : "tools" });
      emit({
        event: "capabilities",
        op: decision.mode === "draft" ? "replace" : "add",
        bound,
        suggested,
        remove: removals,
      });
      timings.capabilitiesMs = elapsed();
      return bound;
    };

    const capabilitiesDone: Promise<DraftPick[]> = wantsCaps
      ? judgePromise.then((judged) => sendCapabilities(judged))
      : Promise.resolve(removals.length > 0 ? sendCapabilities(null) : []);

    // Instructions.
    if (fields.has("instructions")) {
      const early = wantsCaps
        ? await Promise.race([capabilitiesDone, sleep(CAPABILITY_WAIT_MS).then(() => undefined)])
        : [];
      const known: DraftPick[] = [
        ...(decision.mode === "edit"
          ? input.canvas.capabilities.map((c): DraftPick => ({ hub: c.hub, id: c.id, label: c.label, confidence: 1, reason: "" }))
          : []),
        ...(early ?? []),
      ];
      const instructionsInput: InstructionsInput = {
        name,
        description,
        brief: decision.instructionsBrief,
        permissionMode,
        schedule:
          decision.schedule && decision.schedule !== "clear"
            ? decision.schedule
            : decision.schedule === "clear"
              ? null
              : input.canvas.schedule,
        capabilities: known,
        ...(decision.mode === "edit" && input.canvas.instructions.trim()
          ? { existing: { text: input.canvas.instructions, change: input.message } }
          : {}),
      };
      emit({ event: "field.start", field: "instructions" });
      let result: InstructionsResult;
      try {
        result = await deps.instructions(
          instructionsInput,
          (text) => emit({ event: "instructions.delta", text }),
          turnSignal,
        );
      } catch (err) {
        if (turnSignal.aborted) throw err;
        warn("instructions", "The instructions took too long, so I used a simple version to edit.");
        result = finishInstructions(templateInstructions(instructionsInput), instructionsInput);
      }

      // Tools chosen after the instructions started still belong in them.
      if (early === undefined) {
        const lateBound = await capabilitiesDone;
        if (lateBound.length > 0) {
          const section = toolsSection(lateBound);
          emit({ event: "instructions.section", heading: section.heading, markdown: section.markdown });
          result = finishInstructions(replaceSection(result.text, section.heading, section.markdown), instructionsInput);
        }
      }
      timings.instructionsMs = elapsed();
      emit({
        event: "instructions.done",
        text: result.text,
        contract: result.contract,
        repaired: result.repaired,
      });
    } else {
      await capabilitiesDone;
    }

    emit({ event: "ack", text: decision.ack });
    finish(partial ? "partial" : "completed");
  } catch (err) {
    judgeAbort.abort();
    if (signal.aborted) {
      finish("cancelled");
      return;
    }
    if (turnSignal.aborted) {
      emit({ event: "error", code: "llm_timeout", message: "The draft took too long. What landed is on the canvas; try again for the rest.", retryable: true });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    emit({ event: "error", code: "internal", message: message.slice(0, 200), retryable: true });
  }
}
