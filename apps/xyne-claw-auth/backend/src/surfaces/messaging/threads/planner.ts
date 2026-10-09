import { createLogger } from "../../../logger.js";
import { errMsg } from "../../../lib/errors.js";
import type { ChatState } from "./state.js";
import type { ChatTask } from "./registry.js";

const log = createLogger("channel-threads-planner");

export interface PlannedAction {
  /** The self-contained request for this task, resolved against the shared
   *  state (so "also hotels" becomes "hotels in <city> from <date>"). */
  request: string;
  /** A two to four word handle for the task, e.g. "flight search". */
  label: string;
  /** 1-based index into the open tasks passed in, or null to start a new task. */
  continueIndex: number | null;
}

export interface PlanResult {
  /** Slot updates to merge into the chat's shared state. */
  slots: Record<string, string>;
  actions: PlannedAction[];
}

const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["slots", "actions"],
  properties: {
    slots: {
      type: "object",
      description: "Durable facts to remember for this conversation (city, dates, travellers, etc.). Keys are short snake_case.",
      additionalProperties: { type: "string" },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["request", "label", "continueIndex"],
        properties: {
          request: { type: "string" },
          label: { type: "string" },
          continueIndex: { type: ["integer", "null"] },
        },
      },
    },
  },
};

const SYSTEM = [
  "You split a person's WhatsApp message to an assistant into independent tasks and keep shared facts.",
  "Rules:",
  "- Return one action per distinct thing to do. A single request is one action.",
  "- Resolve references against the known facts and the open tasks: if they ask for hotels right after a flight to Kolkata tomorrow, the hotels request is 'find hotels in Kolkata from tomorrow'.",
  "- If the message answers or refines an existing open task, set continueIndex to that task's number; otherwise null (a new task).",
  "- Put every durable fact you learn (origin, destination, dates, number of travellers, nights, budget...) into slots so sibling tasks can use it.",
  "- Keep each request self-contained so it can run on its own.",
].join("\n");

function buildUser(text: string, state: ChatState, tasks: ChatTask[]): string {
  const facts = Object.entries(state.slots).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  (none)";
  const open = tasks.length
    ? tasks.map((t, i) => `  ${i + 1}. ${t.label}`).join("\n")
    : "  (none)";
  return [
    `New message:\n  ${text}`,
    `Known facts:\n${facts}`,
    `Open tasks:\n${open}`,
  ].join("\n\n");
}

/**
 * Decompose an inbound message into one or more linked tasks and extract the
 * shared facts. Falls back to a single new task carrying the raw text when the
 * planner is unreachable or returns nothing usable, so a planning failure
 * never drops the message.
 */
export async function planInbound(text: string, state: ChatState, tasks: ChatTask[]): Promise<PlanResult> {
  const fallback: PlanResult = { slots: {}, actions: [{ request: text, label: "request", continueIndex: null }] };
  try {
    // Imported lazily: the entity-llm client runs module-load side effects, so
    // pulling it only when a plan is actually needed keeps it out of the
    // import graph of callers that never reach here.
    const { entityLlm } = await import("../../../services/entityExtraction/entityLlmClient.js");
    const result = await entityLlm.completeJson<PlanResult>({
      system: SYSTEM,
      user: buildUser(text, state, tasks),
      schema: PLAN_SCHEMA,
      schemaName: "WhatsAppThreadPlan",
      purpose: "whatsapp-thread-planner",
    });
    const actions = (result.actions ?? [])
      .map((a) => ({
        request: typeof a.request === "string" ? a.request.trim() : "",
        label: typeof a.label === "string" && a.label.trim() ? a.label.trim().slice(0, 40) : "request",
        continueIndex:
          typeof a.continueIndex === "number" && a.continueIndex >= 1 && a.continueIndex <= tasks.length
            ? a.continueIndex
            : null,
      }))
      .filter((a) => a.request.length > 0);
    if (actions.length === 0) return fallback;
    return { slots: result.slots ?? {}, actions };
  } catch (err) {
    log.warn(`[threads-planner] plan failed, falling back to single task: ${errMsg(err)}`);
    return fallback;
  }
}
