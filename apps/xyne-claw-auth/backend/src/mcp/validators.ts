import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";
import { appFetch, interact, spacesFetch, SpacesApiError, type SpacesAuthContext } from "./servers/xyne-spaces-client.js";
import { SDLC_TOOL_NAMES } from "xyne-claw-shared";
import { spacesConversationExists } from "../lib/spaces-post-target.js";
const log = createLogger("validators");

type ValidatorFn = (
  params: Record<string, unknown>,
  credentials: Record<string, unknown>,
) => Promise<string | null>;

const VALIDATORS: Record<string, ValidatorFn> = {};

function register(serverType: string, tool: string, fn: ValidatorFn): void {
  VALIDATORS[`${serverType}/${tool}`] = fn;
}

export async function validateWriteAction(
  serverType: string,
  tool: string,
  params: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<string | null> {
  const fn = VALIDATORS[`${serverType}/${tool}`];
  if (fn) {
    try {
      const error = await fn(params, credentials);
      if (error) return error;
    } catch (err) {
      log.warn(`[validator] ${serverType}/${tool} threw, allowing approval:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  return validateTargetConversationId(serverType, tool, params, credentials);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function targetConversationId(params: Record<string, unknown>): string | undefined {
  return stringField(params["conversationId"]) ?? stringField(params["targetConversationId"]);
}

function targetChannelId(params: Record<string, unknown>): string | undefined {
  return stringField(params["channelId"]);
}

/**
 * App-MEMBERSHIP check for a write target channel, AT QUEUE TIME. Existence
 * (`interact` findMany) is not enough: a real channel the agent's Spaces app is
 * not a member of passes existence but 403s at card-post time in webhook.ts
 * (`pendingActionTargetValidation` → `/channel/info`), so the action queued,
 * the model said "queued, approve it", and the approval card was silently
 * dropped (prod 2026-08-24, Arya Doctor spaces-create-ticket into a HyperCredit
 * channel). Hitting the SAME `/api/apps/channel/info` endpoint here — with the
 * same app token that will later try to post the card — makes tool-time and
 * card-time agree, so the model narrates the failure instead of a false queue.
 *
 * Fails OPEN on anything other than a definitive 403/404: the authoritative
 * Spaces API stays the final judge, matching the delivery-boundary semantics.
 */
async function validateChannelAppAccess(
  channelId: string,
  auth: SpacesAuthContext,
): Promise<string | null> {
  try {
    await appFetch("/channel/info", { method: "POST", body: JSON.stringify({ channelId }) }, auth);
    return null;
  } catch (err) {
    // Branch on the typed HTTP status, not the message text. Only a definitive
    // 403 (app not a member) or 404 (gone) rejects; anything else fails open so
    // the authoritative Spaces API stays the final judge.
    const status = err instanceof SpacesApiError ? err.status : undefined;
    if (status === 403) {
      return `channel ${channelId} is not accessible — add the app to the channel or choose a channel it can access`;
    }
    if (status === 404) {
      return `channel ${channelId} not found — use a real Spaces channel id`;
    }
    log.warn(
      `[validator] channel access check failed open channelId=${channelId} status=${status ?? "n/a"}:`,
      errMsg(err),
    );
    return null;
  }
}

/** The acting user's Spaces auth out of a connector credential bag. */
function spacesAuthFromCredentials(credentials: Record<string, unknown>): SpacesAuthContext {
  const auth: SpacesAuthContext = {};
  const token = stringField(credentials["token"]);
  const sessionId = stringField(credentials["sessionId"]);
  const workspaceId = stringField(credentials["workspaceId"]);
  const baseUrl = stringField(credentials["url"]);
  if (token) auth.token = token;
  if (sessionId) auth.sessionId = sessionId;
  if (workspaceId) auth.workspaceId = workspaceId;
  if (baseUrl) auth.baseUrl = baseUrl;
  return auth;
}

async function validateTargetConversationId(
  serverType: string,
  tool: string,
  params: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<string | null> {
  if (serverType !== "xyne-spaces") return null;
  if (tool === "spaces-send-ticket-email") return null;
  const conversationId = targetConversationId(params);
  const channelId = targetChannelId(params);

  if (tool === "user-send-message") {
    if (!!conversationId === !!channelId) {
      return "provide exactly one target: use conversationId for an existing thread or channelId to post into a channel";
    }
  }

  const auth = spacesAuthFromCredentials(credentials);

  if (conversationId) {
    if ((await spacesConversationExists(conversationId, auth)) === true) return null;
    try {
      await spacesFetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=1`,
        { method: "GET" },
        auth,
      );
      return null;
    } catch (err) {
      const msg = errMsg(err);
      if (/Spaces API 404/i.test(msg) || (/conversation not found/i.test(msg) && /\b404\b/.test(msg))) {
        return `conversation ${conversationId} not found — use a real Spaces conversation id, e.g. from the triggering thread`;
      }
      log.warn(`[validator] ${serverType}/${tool} conversation lookup failed open conversationId=${conversationId}:`, msg);
      return null;
    }
  }

  if (!channelId) return null;

  // Reject a hallucinated channelId AT QUEUE TIME, while the model can still
  // self-correct in the same run. Without this, the action queues ("Action
  // queued for approval: ..."), and the card-time target validation in
  // webhook.ts then skips the approval card with only a server log — the user
  // was promised an approval that never arrives, and retrying repeats the
  // identical dead end (prod 2026-08-07, fe-autocoder spaces-create-ticket).
  //
  // This is an EXACT-id findMany, not the paginated workspace list whose
  // `.includes` false-negatives got pre-checks removed here before (see the
  // create-ticket note below): only a definitive empty result rejects; any
  // lookup failure fails open so the authoritative Spaces API stays the
  // final judge.
  try {
    const rows = (await interact(
      { model: "channel", operation: "findMany", where: { id: { equals: channelId } }, take: 1 },
      auth,
    )) as unknown[];
    if (Array.isArray(rows) && rows.length === 0) {
      // Did-you-mean recovery: ids that reach us corrupted are almost always
      // near-misses of a real id the model re-typed from its own prose
      // (prod 2026-08-10: fe-autocoder dropped 2 chars mid-cuid). Cuids share
      // long time-ordered prefixes, so a prefix lookup names the intended
      // channel and lets the agent self-correct in ONE step instead of
      // guessing. Suggestions only — never silently substitute a write target.
      let suggestion = "";
      try {
        const prefix = channelId.slice(0, 12);
        if (prefix.length >= 8) {
          const near = (await interact(
            {
              model: "channel",
              operation: "findMany",
              where: { id: { startsWith: prefix } },
              select: { id: true, name: true },
              take: 3,
            },
            auth,
          )) as Array<{ id?: string; name?: string }>;
          if (Array.isArray(near) && near.length > 0) {
            suggestion =
              " Close id matches: " +
              near.map((c) => `${c.name ?? "(unnamed)"} = ${c.id}`).join("; ") +
              ". If one of these is the intended channel, retry with that EXACT id (copy it verbatim).";
          }
        }
      } catch {
        // best-effort — the not-found error below stands on its own
      }
      return `channel ${channelId} not found — use a real Spaces channel id (resolve it with the spaces-channels tool by exact name, or from the triggering thread).${suggestion}`;
    }
    // The channel exists — now confirm the agent's app can actually reach it, so
    // a write into a channel the app isn't a member of fails HERE (model can
    // retry a reachable channel) instead of queuing and then losing its approval
    // card at delivery time. Same app token, same endpoint as the card path.
    return await validateChannelAppAccess(channelId, auth);
  } catch (err) {
    const msg = errMsg(err);
    log.warn(`[validator] ${serverType}/${tool} channel lookup failed open channelId=${channelId}:`, msg);
    return null;
  }
}

/**
 * Custom-field names, checked against the BOARD's ticket form at queue time.
 *
 * The Spaces create path resolves `dynamicFields` by field NAME and silently
 * drops anything it does not recognise, so a model that invents "mid" instead
 * of "MID" gets a ticket with an empty field and a cheerful "created" —
 * exactly the failure nobody sees until the desk is wrong. Rejecting here
 * instead means the model self-corrects in the same run, before a human is
 * asked to approve a write that cannot do what the card says.
 *
 * Fails OPEN on any lookup problem, like the channel check above: the Spaces
 * API stays the authority, and a board-fields hiccup must not block a ticket.
 */
type BoardField = {
  fieldName?: string;
  /** A Spaces FormFieldType, exactly as the board-fields endpoint reports it. */
  fieldType?: string;
  required?: boolean;
  /** A select field's allowed values; empty when the form lists none. */
  options?: string[];
  /** Set on a branch field: it applies only while its parent holds this value. */
  shownWhen?: { fieldName?: string; equals?: string };
};

/**
 * A board's ticket form, fetched once per board. `cache` lets a batch judge 25
 * tickets on one board without 25 identical round trips; without it each call
 * fetches, which is what a single-ticket create wants.
 */
async function boardFields(
  boardId: string,
  auth: SpacesAuthContext,
  cache?: Map<string, BoardField[] | null>,
): Promise<BoardField[] | null> {
  const hit = cache?.get(boardId);
  if (hit !== undefined) return hit;
  let fields: BoardField[] | null;
  try {
    const data = (await spacesFetch(
      `/api/tickets/claw/board-fields?boardId=${encodeURIComponent(boardId)}`,
      { method: "GET" },
      auth,
    )) as { fields?: BoardField[] };
    fields = Array.isArray(data?.fields) ? data.fields : [];
  } catch (err) {
    log.warn(`[validator] board-fields lookup failed open boardId=${boardId}:`, errMsg(err));
    fields = null;
  }
  cache?.set(boardId, fields);
  return fields;
}

/**
 * Spaces' FormFieldType values (packages/shared/src/zero/types.ts). claw-auth
 * can't import the @xyne/shared root, so this is a local mirror — keep the two
 * in step, or a new type falls through to "left to the Spaces API" below.
 */
const FormFieldType = {
  STRING: "STRING",
  NUMBER: "NUMBER",
  BOOLEAN: "BOOLEAN",
  DATE: "DATE",
  SINGLE_SELECT: "SINGLE_SELECT",
  MULTI_SELECT: "MULTI_SELECT",
  USER: "USER",
  DOC: "DOC",
  TICKET: "TICKET",
} as const;

/**
 * One value judged against its field's type. The type names are Spaces'
 * FormFieldType values, and the rules follow what each write path stores:
 *
 * - An update goes through Spaces' own per-type normaliser, which refuses a
 *   wrong shape — but only after the human has approved, so it is caught here.
 * - A create stores the value exactly as sent, with no check at all, so a
 *   wrong shape here is the only thing between the model and a junk field.
 *
 * An unrecognised type is left to the Spaces API rather than guessed at.
 */
function fieldValueError(field: BoardField, value: unknown, op: "create" | "update"): string | null {
  const name = field.fieldName as string;
  const filled = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  const options = Array.isArray(field.options) ? field.options : [];
  const allowed = options.length > 0 ? ` Allowed values: ${options.join(" | ")}.` : "";

  switch (field.fieldType) {
    case FormFieldType.STRING:
      return filled(value) ? null : `${name} must be a non-empty string.`;

    case FormFieldType.NUMBER: {
      const numeric = typeof value === "number" ? value : filled(value) ? Number(value) : Number.NaN;
      return Number.isFinite(numeric) ? null : `${name} must be a number.`;
    }

    case FormFieldType.BOOLEAN: {
      if (typeof value === "boolean") return null;
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      return text === "true" || text === "false" ? null : `${name} must be true or false.`;
    }

    case FormFieldType.DATE:
      return filled(value) && !Number.isNaN(new Date(value).getTime())
        ? null
        : `${name} must be a date, e.g. "2026-01-31".`;

    case FormFieldType.SINGLE_SELECT:
      if (!filled(value)) return `${name} must be a single value.${allowed}`;
      // Compared untrimmed: a create stores the string as sent, and a padded
      // option is not the option.
      return options.length > 0 && !options.includes(value)
        ? `${name} does not accept "${value}".${allowed}`
        : null;

    // Both hold a list. A create stores a bare string as a bare string, so the
    // list shape is asked for outright instead of being wrapped on the way in.
    case FormFieldType.MULTI_SELECT: {
      if (!Array.isArray(value) || value.length === 0 || !value.every(filled)) {
        return `${name} must be a non-empty list of values.${allowed}`;
      }
      const invalid = options.length > 0 ? value.filter((entry) => !options.includes(entry)) : [];
      return invalid.length > 0 ? `${name} does not accept ${invalid.join(", ")}.${allowed}` : null;
    }

    case FormFieldType.USER:
      return Array.isArray(value) && value.length > 0 && value.every(filled)
        ? null
        : `${name} must be a non-empty list of user IDs (resolve them with spaces-users).`;

    // A ticket reference is stored as that ticket's id on create; Spaces'
    // update normaliser has no case for it and refuses the write.
    case FormFieldType.TICKET:
      if (op === "update") return `${name} is a ticket-link field and cannot be set through this tool.`;
      return filled(value) ? null : `${name} must be a ticket ID.`;

    // Holds an attachment bound to the field's own row by the upload pipeline;
    // there is no value a tool call could pass that would be one.
    case FormFieldType.DOC:
      return `${name} is a file field and cannot be set through this tool — leave it out.`;

    default:
      return null;
  }
}

async function validateBoardCustomFields(
  boardId: string,
  fields: Record<string, unknown>,
  auth: SpacesAuthContext,
  opts: { requireAll?: boolean; op?: "create" | "update"; cache?: Map<string, BoardField[] | null> } = {},
): Promise<string | null> {
  const names = Object.keys(fields);
  if (names.length === 0) return null;
  const known = await boardFields(boardId, auth, opts.cache);
  // Null means the lookup itself failed; the Spaces API stays the judge.
  if (!known) return null;

  const knownNames = known.map((f) => f.fieldName).filter((n): n is string => !!n);
  if (knownNames.length === 0) {
    return `board ${boardId} has no ticket custom fields — remove ${names.join(", ")} from dynamicFields`;
  }
  const unknown = names.filter((name) => !knownNames.includes(name));
  if (unknown.length > 0) {
    return (
      `unknown custom field${unknown.length > 1 ? "s" : ""} for this board: ${unknown.join(", ")}. ` +
      `This board's fields are: ${knownNames.join(", ")}. Field names are case-sensitive — ` +
      `resolve them with spaces-board-fields and retry with the exact names.`
    );
  }

  const valueErrors = known
    .filter((f) => f.fieldName && names.includes(f.fieldName))
    .map((f) => fieldValueError(f, fields[f.fieldName as string], opts.op ?? "create"))
    .filter((e): e is string => !!e);
  if (valueErrors.length > 0) {
    return `${valueErrors.join(" ")} Check the field types with spaces-board-fields and retry.`;
  }

  // Half a form is its own kind of wrong: a model that has started filling
  // this board's fields should finish them, and the one who knows the missing
  // value is the person it is talking to. Only checked once at least one field
  // was passed — an agent that sends none is creating an ordinary ticket and
  // is not made to collect a form it never mentioned.
  // A branch field only applies while its parent holds the value that reveals
  // it, so demanding "Refund amount" when Issue type is "Login" would send the
  // agent asking for something the form itself would never show.
  const applies = (field: BoardField): boolean => {
    const parent = field.shownWhen;
    if (!parent?.fieldName) return true;
    const parentValue = fields[parent.fieldName];
    // A multi-select parent holds a list, so the branch applies when the
    // revealing option is among the chosen ones.
    if (Array.isArray(parentValue)) {
      return parentValue.some((entry) => typeof entry === "string" && entry.trim() === parent.equals);
    }
    return typeof parentValue === "string" && parentValue.trim() === parent.equals;
  };
  const missingRequired = (opts.requireAll ?? true)
    ? known
        .filter(
          (f) =>
            f.required &&
            f.fieldName &&
            // A file field is filled in after the ticket exists, in the
            // dashboard as much as here, so it is never asked for up front.
            f.fieldType !== FormFieldType.DOC &&
            applies(f) &&
            !names.includes(f.fieldName),
        )
        .map((f) => f.fieldName as string)
    : [];
  if (missingRequired.length > 0) {
    return (
      `this board also requires ${missingRequired.join(", ")}. Ask the person for ${missingRequired.length > 1 ? "those values" : "that value"} ` +
      `and include ${missingRequired.length > 1 ? "them" : "it"} in dynamicFields.`
    );
  }
  return null;
}

register("xyne-spaces", "spaces-create-ticket", async (params, credentials) => {
  const projectId = (params["projectId"] as string | undefined)?.trim();
  const boardId = (params["boardId"] as string | undefined)?.trim();
  const channelId = (params["channelId"] as string | undefined)?.trim();
  const title = (params["title"] as string | undefined)?.trim();
  const description = (params["description"] as string | undefined)?.trim();

  if (!title) return "title is required";
  if (!description) return "description is required";
  if (!projectId) return "projectId is required";
  if (!boardId) return "boardId is required";
  if (!channelId) return "channelId is required";

  const dynamicFields = params["dynamicFields"];
  if (dynamicFields !== undefined) {
    if (typeof dynamicFields !== "object" || dynamicFields === null || Array.isArray(dynamicFields)) {
      return "dynamicFields must be an object keyed by field name, e.g. { \"MID\": \"merchant_1234\" }";
    }
    const fieldError = await validateBoardCustomFields(
      boardId,
      dynamicFields as Record<string, unknown>,
      spacesAuthFromCredentials(credentials),
    );
    if (fieldError) return fieldError;
  }

  // ID existence (project / board / channel) is validated authoritatively by
  // the Spaces create-ticket API. On failure, the write-retry loop
  // (XYNE-13828) posts the real error back so the agent can self-correct. We
  // deliberately do NOT pre-check existence here: the old string-`.includes`
  // lookup ran over a paginated, workspace-wide list and produced false
  // negatives (rejecting perfectly valid boards), and because a validator
  // rejection is not a write-action failure it bypassed the retry loop
  // entirely. Required-field checks above are enough.
  return null;
});

register("xyne-spaces", "spaces-create-bulk-tickets", async (params, credentials) => {
  // Bulk inherits the single-ticket rule: a mistyped field name is dropped
  // silently by the create path, so N tickets would be made with an empty
  // field and a cheerful success line. Validated against each distinct board
  // the batch touches, which is almost always exactly one.
  const tickets = Array.isArray(params["tickets"]) ? (params["tickets"] as Array<Record<string, unknown>>) : [];
  if (tickets.length === 0) return "tickets must contain at least one ticket";
  const defaultBoardId = (params["boardId"] as string | undefined)?.trim();
  const asMap = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

  const defaults = asMap(params["defaultDynamicFields"]);
  if (params["defaultDynamicFields"] !== undefined && !defaults) {
    return "defaultDynamicFields must be an object keyed by field name";
  }

  const auth = spacesAuthFromCredentials(credentials);
  const cache = new Map<string, BoardField[] | null>();
  for (const [index, ticket] of tickets.entries()) {
    const raw = ticket["dynamicFields"];
    const own = asMap(raw);
    if (raw !== undefined && !own) {
      return `ticket ${index + 1}: dynamicFields must be an object keyed by field name`;
    }
    // Per-ticket fields REPLACE the defaults, matching the tool's contract.
    const fields = own ?? defaults;
    const boardId = (ticket["boardId"] as string | undefined)?.trim() || defaultBoardId;
    if (!fields || Object.keys(fields).length === 0 || !boardId) continue;
    const fieldError = await validateBoardCustomFields(boardId, fields, auth, { cache });
    if (fieldError) return `ticket ${index + 1}: ${fieldError}`;
  }
  return null;
});

register("xyne-spaces", "spaces-schedule-call", async (params) => {
  const title = (params["title"] as string | undefined)?.trim();
  const startsAt = (params["startsAt"] as string | undefined)?.trim();
  const endsAt = (params["endsAt"] as string | undefined)?.trim();
  const channelId = (params["channelId"] as string | undefined)?.trim();
  const targetUserIds = Array.isArray(params["targetUserIds"]) ? (params["targetUserIds"] as string[]) : [];

  if (!title) return "title is required";
  if (!startsAt) return "startsAt is required (ISO 8601)";
  if (!endsAt) return "endsAt is required (ISO 8601)";
  if (!channelId && targetUserIds.length === 0) return "either channelId or targetUserIds is required";

  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  if (Number.isNaN(startMs)) return `startsAt ${startsAt} is not a valid ISO 8601 timestamp`;
  if (Number.isNaN(endMs)) return `endsAt ${endsAt} is not a valid ISO 8601 timestamp`;
  if (endMs <= startMs) return "endsAt must be after startsAt";

  // channelId existence is validated by the Spaces API; see the create-ticket
  // note above. No pre-flight `.includes` lookup.
  return null;
});


register("xyne-spaces", "spaces-update-ticket", async (params, credentials) => {
  const ticketId = (params["ticketId"] as string | undefined)?.trim();
  const assigneeId = (params["assigneeId"] as string | undefined)?.trim();
  const stage = (params["stage"] as string | undefined)?.trim();
  const groupId = (params["groupId"] as string | undefined)?.trim();
  const title = (params["title"] as string | undefined)?.trim();
  const description = (params["description"] as string | undefined)?.trim();
  const priority = (params["priority"] as string | undefined)?.trim();
  const status = (params["status"] as string | undefined)?.trim();
  const eta = (params["eta"] as string | undefined)?.trim();

  const customFields = params["customFields"];
  const customFieldMap =
    customFields && typeof customFields === "object" && !Array.isArray(customFields)
      ? (customFields as Record<string, unknown>)
      : null;
  if (customFields !== undefined && !customFieldMap) {
    return "customFields must be an object keyed by field name, e.g. { \"MID\": \"merchant_1234\" }";
  }
  const hasCustomFields = !!customFieldMap && Object.keys(customFieldMap).length > 0;

  if (!ticketId) return "ticketId is required";
  const tagsProvided = params["tags"] !== undefined;
  if (
    !assigneeId && !stage && !groupId && !title && !description && !priority && !status && !eta &&
    !tagsProvided && !hasCustomFields
  ) {
    return "at least one update field is required (assigneeId, stage, groupId, title, description, priority, status, eta, tags, or customFields)";
  }

  if (priority && !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priority)) {
    return `priority must be LOW, MEDIUM, HIGH, or CRITICAL — got "${priority}"`;
  }
  if (status && !["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"].includes(status)) {
    return `status must be TODO, STARTED, PAUSED, CANCELLED, or COMPLETED — got "${status}"`;
  }
  if (eta && Number.isNaN(new Date(eta).getTime())) {
    return `eta is not a valid ISO 8601 date — got "${eta}"`;
  }

  if (customFieldMap && hasCustomFields) {
    const auth = spacesAuthFromCredentials(credentials);
    try {
      const rows = (await interact(
        { model: "ticket", operation: "findMany", where: { id: { equals: ticketId } }, take: 1 },
        auth,
      )) as Array<{ boardId?: string }>;
      const boardId = rows?.[0]?.boardId;
      if (boardId) {
        // Only the names are judged on an update: a partial write must not be
        // made to supply every required field on the board.
        const fieldError = await validateBoardCustomFields(boardId, customFieldMap, auth, {
          requireAll: false,
          op: "update",
        });
        if (fieldError) return fieldError;
      }
    } catch (err) {
      log.warn(`[validator] board lookup for spaces-update-ticket failed open:`, errMsg(err));
    }
  }

  // ticketId / assigneeId existence is validated by the Spaces update-ticket
  // API; see the create-ticket note above. No pre-flight `.includes` lookup.
  return null;
});

register("xyne-spaces", "spaces-send-ticket-email", async (params, credentials) => {
  const ticketId = (params["ticketId"] as string | undefined)?.trim();
  const conversationId = (params["conversationId"] as string | undefined)?.trim();
  const body = (params["body"] as string | undefined)?.trim();
  const subject = (params["subject"] as string | undefined)?.trim();
  // The handler accepts a comma/semicolon-separated string as well as a list,
  // so the check has to read the same shapes the send will.
  const addresses = (value: unknown): string[] =>
    (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\s]+/) : [])
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  const to = addresses(params["to"]);

  if (!ticketId && !conversationId) return "ticketId or conversationId is required";
  if (!body) return "body is required — write the whole email";
  if (to.length === 0) {
    return "at least one recipient is required — ask the person for the merchant's email address rather than inventing one";
  }
  // A missing "@" is a name or a placeholder, not an address: sending it fails
  // at the provider, after a human has already approved it. Cc and Bcc are
  // checked too — the handler drops a malformed one silently, so the approver
  // would have seen a recipient on the card that never got the mail.
  const valid = (address: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  for (const [field, list] of [
    ["to", to],
    ["cc", addresses(params["cc"])],
    ["bcc", addresses(params["bcc"])],
  ] as const) {
    const malformed = list.filter((address) => !valid(address));
    if (malformed.length > 0) {
      return `${field} contains something that is not an email address: ${malformed.join(", ")}. Ask the person for the real addresses.`;
    }
  }

  // Resolve the ticket HERE, not in the handler. A write tool's handler only
  // runs once a human has approved the card, so an id that resolves to nothing
  // would spend their approval on an error — and they would have approved
  // sending mail "from a ticket" that was never found.
  //
  // Queried through the same client the other checks use rather than the tools
  // module: that module is the MCP child process's, and importing it here to
  // reuse one lookup would load all of it into claw-auth.
  const auth = spacesAuthFromCredentials(credentials);
  const findTicket = async (
    where: Record<string, unknown>,
  ): Promise<{ conversationId?: string; channelId?: string } | null> => {
    const rows = (await interact({ model: "ticket", operation: "findMany", where, take: 1 }, auth)) as Array<{
      conversationId?: string;
      channelId?: string;
    }>;
    return rows?.[0] ?? null;
  };
  const conversationTarget = async (
    id: string,
    ctxAuth: SpacesAuthContext,
  ): Promise<{ conversationId?: string; channelId?: string } | null> => {
    try {
      const rows = (await interact(
        { model: "conversation", operation: "findMany", where: { conversationId: { equals: id } }, take: 1 },
        ctxAuth,
      )) as Array<{ conversationId?: string; channelId?: string }>;
      return rows?.[0] ?? null;
    } catch {
      // Fails open like every other lookup here.
      return { conversationId: id };
    }
  };
  const findChannel = async (id: string): Promise<{ name?: string; type?: string } | null> => {
    const rows = (await interact(
      { model: "channel", operation: "findMany", where: { id: { equals: id } }, take: 1 },
      auth,
    )) as Array<{ name?: string; type?: string }>;
    return rows?.[0] ?? null;
  };
  try {
    // A Xyne id (PROG-412) is what people quote, so the tool accepts it too.
    const ticket = conversationId
      ? await findTicket({ conversationId: { equals: conversationId } })
      : ((await findTicket({ id: { equals: ticketId } })) ??
        (await findTicket({ xyneId: { equals: ticketId } })));
    if (!ticket && ticketId) {
      return `no ticket found for ${ticketId} — resolve it with spaces-tickets and pass its Internal ID`;
    }
    const target = ticket ?? (await conversationTarget(String(conversationId), auth));
    if (!target) {
      return `no conversation ${conversationId} — pass a ticket's conversationId, or its Internal ID as ticketId`;
    }
    if (!target.conversationId) {
      return `ticket ${ticketId ?? conversationId} has no conversation to put the email on`;
    }

    // Only an EMAIL desk has a mailbox. An app or Slack desk carries its own kind of thread.
    const channel = target.channelId ? await findChannel(target.channelId) : null;
    if (channel && channel.type !== "EMAIL") {
      return (
        `ticket ${ticketId ?? conversationId} is on ${channel.name ? `#${channel.name}` : "a channel"}, ` +
        `which is ${channel.type === "APP" ? "an app desk" : channel.type === "SLACK" ? "a Slack desk" : `a ${channel.type} channel`} ` +
        `and has no mailbox. Email can only be sent from an email desk — tell the person that, and reply on the ` +
        `thread itself instead if they need to respond there.`
      );
    }

    if (!subject) {
      const existing = (await interact(
        {
          model: "email",
          operation: "findMany",
          where: { conversationId: { equals: target.conversationId } },
          take: 1,
        },
        auth,
      )) as unknown[];
      if (Array.isArray(existing) && existing.length === 0) {
        return "subject is required for the first email on this ticket — there is no earlier email to take one from, and the approver has to see what the customer will";
      }
    }
  } catch (err) {
    log.warn(`[validator] ticket lookup for send-ticket-email failed open:`, errMsg(err));
  }
  return null;
});

register("xyne-spaces", "spaces-memory-create", async (params) => {
  const docType = (params["docType"] as string | undefined)?.trim();
  const content = (params["content"] as string | undefined)?.trim();

  if (!docType) return "docType is required";
  if (docType !== "fact" && docType !== "sop") return `docType must be "fact" or "sop", got "${docType}"`;
  if (!content) return "content is required";
  if (content.length < 10) return "content is too short — provide a meaningful fact or procedure (min 10 chars)";

  return null;
});

register("xyne-spaces", "spaces-create-canvas", async (params) => {
  const title = (params["title"] as string | undefined)?.trim();
  const markdown = params["markdown"] as string | undefined;
  const visibility = (params["visibility"] as string | undefined)?.trim();

  if (!title) return "title is required";
  if (!markdown) return "markdown content is required";
  if (typeof markdown === "string" && Buffer.byteLength(markdown, "utf8") > 5 * 1024 * 1024) {
    return "markdown exceeds the 5MB limit";
  }
  if (visibility && visibility !== "PUBLIC" && visibility !== "PRIVATE") {
    return `visibility must be "PUBLIC" or "PRIVATE", got "${visibility}"`;
  }

  return null;
});

register("xyne-spaces", "spaces-edit-canvas", async (params) => {
  const viewAccessId = (params["viewAccessId"] as string | undefined)?.trim();
  const content = params["content"] as string | undefined;

  if (!viewAccessId) return "viewAccessId is required";
  if (!content) return "content is required";
  if (typeof content === "string" && Buffer.byteLength(content, "utf8") > 5 * 1024 * 1024) {
    return "content exceeds the 5MB limit";
  }

  return null;
});

register("xyne-spaces", SDLC_TOOL_NAMES.writeArtifact, async (params) => {
  const action = String(params["action"] ?? "");
  const has = (key: string) => String(params[key] ?? "").trim().length > 0;
  const wiki = params["kind"] === "WIKI";
  const required: Record<string, string[]> = {
    create: wiki ? ["channelId", "title", "markdown"] : ["artifactTypeId", "title", "markdown"],
    update: wiki ? ["canvasId", "markdown"] : ["canvasId"],
    replace_section: ["canvasId", "heading", "markdown"],
    insert_section: ["canvasId", "heading", "markdown"],
    remove_section: ["canvasId", "heading"],
    move: wiki ? ["canvasId", "folderPath"] : ["canvasId", "parentId"],
  };
  const keys = required[action];
  if (!keys) return `action must be one of ${Object.keys(required).join(", ")}`;
  if (wiki && !has("channelId")) return "channelId is required for Wiki pages";
  const missing = keys.find((key) => key !== "folderPath" && !has(key));
  if (missing) return `${missing} is required for ${action}`;
  if (action === "move" && wiki && typeof params["folderPath"] !== "string") return "folderPath is required for move";
  if (action === "update" && !wiki && !has("markdown") && !has("title") && !(params["relatedCanvasIds"] as unknown[] | undefined)?.length) {
    return "update needs markdown, title or relatedCanvasIds";
  }
  if (has("trackFolderId") && !has("trackId")) return "trackFolderId needs the trackId it sits in";
  return null;
});

register("xyne-spaces", SDLC_TOOL_NAMES.createTrackFolder, async (params) => {
  for (const key of ["channelId", "trackId", "name"]) {
    if (!String(params[key] ?? "").trim()) return `${key} is required`;
  }
  if (String(params["name"]).trim().length > 120) return "name must be at most 120 characters";
  return null;
});

register("xyne-spaces", SDLC_TOOL_NAMES.createPullRequest, async (params) => {
  for (const key of ["workspaceId", "actorUserId", "repoId", "title", "head", "base"]) {
    if (!String(params[key] ?? "").trim()) return `${key} is required`;
  }
  if (String(params["title"]).trim().length > 256) return "title must be at most 256 characters";
  if (String(params["body"] ?? "").length > 65_536) return "body must be at most 65536 characters";
  return null;
});

for (const tool of [SDLC_TOOL_NAMES.readArtifact, SDLC_TOOL_NAMES.listArtifactVersions, SDLC_TOOL_NAMES.archiveArtifact]) {
  register("xyne-spaces", tool, async (params) => {
    const canvasId = String(params["canvasId"] ?? "").trim();
    if (!canvasId) return "canvasId is required";
    if (canvasId.length > 256) return "canvasId must be at most 256 characters";
    if (tool === SDLC_TOOL_NAMES.archiveArtifact && !["archive", "restore"].includes(String(params["action"]))) {
      return "action must be archive or restore";
    }
    if (tool === SDLC_TOOL_NAMES.listArtifactVersions && params["limit"] !== undefined) {
      const limit = Number(params["limit"]);
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
        return "limit must be an integer between 1 and 25";
      }
    }
    return null;
  });
}
