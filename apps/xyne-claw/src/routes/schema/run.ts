/**
 * Wire contracts for the routes in run.ts.
 *
 * Loose, not strict: claw-auth spreads opaque objects into these bodies and
 * replays stored payloads, so unknown keys must pass through.
 * `reportUndeclaredBodyKeys` logs them until the declared set can be closed.
 */
import { z } from "zod";
import { boundedText, nonBlankString, safeId, trimmedSafeId, truncatedText } from "./common.js";

const skill = z.looseObject({
  slug: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  content: z.string(),
  files: z
    .array(
      z.looseObject({
        relativePath: z.string(),
        content: z.string(),
        contentType: z.string().nullish(),
      }),
    )
    .optional(),
});

const providerConfig = z.looseObject({
  apiKey: z.string(),
  model: z.string(),
  baseUrl: z.string().optional(),
  authType: z.string().optional(),
  reasoningEffort: z.string().optional(),
});

const attachment = z.looseObject({
  fileName: z.string(),
  mimeType: z.string(),
  data: z.string(),
});

const recordingRef = z.looseObject({
  attachmentId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSize: z.number(),
});

const contextFile = z.looseObject({
  path: z.string(),
  content: z.string(),
});

const awakening = z.looseObject({
  kind: z.string(),
  writePolicy: z.string(),
  shadow: z.boolean(),
  injectEnabled: z.boolean().optional(),
  windowStartMs: z.number().optional(),
  windowEndMs: z.number().optional(),
  entryPath: z.string().optional(),
});

const researchContext = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string(),
  repositoryId: z.string().optional(),
  productId: z.string().optional(),
});

const experiment = z.looseObject({
  id: z.string().optional(),
  epoch: z.number().optional(),
  deadlineAt: z.string().optional(),
  focus: z.string().optional(),
  kind: z.enum(["understanding", "framework", "security", "repo-history"]).optional(),
});

const agentHandoff = z.looseObject({
  resume: z.string().nullish(),
  fresh: z.string().nullish(),
});

/** The callable union has no discriminator; assert only what the runtime keys
 *  on so a spec from a newer claw-auth still reaches the executor. */
const customSubagent = z.looseObject({ name: z.string(), description: z.string() });
const callableAgent = z.looseObject({ slug: z.string(), name: z.string() });

export const internalRunPayloadSchema = z.looseObject({
  // Required in production — these four replace the hand-rolled checks that
  // used to live at the top of the handler.
  userId: nonBlankString,
  task: nonBlankString,
  // safeId, not a plain identifier: sessionId reaches path.join for the
  // workspace and session dirs (and rm -rf on cleanup) and the callback URL.
  // Trimmed variant because the handler trimmed it before calling isSafeId.
  sessionId: trimmedSafeId,
  sessionToken: nonBlankString,

  userName: z.string().optional(),
  userEmail: z.string().optional(),
  context: z.string().optional(),
  conversationId: safeId.optional(),
  piSessionConversationId: z.string().optional(),
  spacesConversationId: z.string().optional(),
  callbackUrl: z.string().optional(),
  systemPrompt: z.string().optional(),
  agentConfig: z.record(z.string(), z.unknown()).optional(),
  agentSlug: safeId.optional(),
  channelId: z.string().optional(),
  cwd: z.string().optional(),
  eventType: z.string().optional(),
  scheduledJobId: z.string().optional(),
  traceId: z.string().optional(),
  skills: z.array(skill).optional(),
  provider: z.string().optional(),
  providerOrder: z.array(z.string()).optional(),
  subagentProviders: z.record(z.string(), z.string()).optional(),
  subagentProviderMode: z.enum(["parent", "spaces", "fast-model"]).optional(),
  providerConfigs: z.record(z.string(), providerConfig).optional(),
  progressUrl: z.string().optional(),
  attachments: z.array(attachment).optional(),
  recordingRefs: z.array(recordingRef).optional(),
  contextFiles: z.array(contextFile).optional(),
  awakening: awakening.optional(),
  additionalInstructions: z.string().optional(),
  researchContext: researchContext.optional(),
  customSubagents: z.array(customSubagent).optional(),
  callableAgents: z.array(callableAgent).optional(),
  delegationMode: z.literal("orchestrator").optional(),
  ticketIds: z.array(z.string()).optional(),
  canvasIds: z.array(z.string()).optional(),
  callIds: z.array(z.string()).optional(),
  // Becomes a GCS object name (claw-results/<key>.json) — same charset guard.
  idempotencyKey: safeId.optional(),
  // `cwd` keeps its handler check: isAllowedCwd reads
  // XYNE_CLAW_ALLOWED_CWD_ROOTS at request time, so it cannot be a static schema rule.
  compactBeforeRun: z.boolean().optional(),
  isRegenerate: z.boolean().optional(),
  detached: z.boolean().optional(),
  fastMode: z.boolean().optional(),
  resumedFromHandoff: z.boolean().optional(),
  optimizations: z.unknown().optional(),
  memoryBankId: z.string().optional(),
  senderName: z.string().optional(),
  channelName: z.string().optional(),
  mode: z.enum(["plan", "auto", "daily_brief"]).optional(),
  experiment: experiment.optional(),
  planContinuation: z.boolean().optional(),
  generateFollowUpSuggestions: z.boolean().optional(),
  agentHandoff: agentHandoff.optional(),

  // Declared passengers: sent by claw-auth, never read by the runtime.
  // `__persistedByCaller` is consumed by claw-auth's own start-run.ts and only
  // rides along because the same object is forwarded verbatim.
  orgId: z.string().optional(),
  __persistedByCaller: z.boolean().optional(),
});

export type InternalRunPayloadInput = z.infer<typeof internalRunPayloadSchema>;

/**
 * Types only. The charset guard stays in the handler, on the key
 * buildSandboxStoreKey DERIVES — its 128-char cap applies to the composite and
 * the composer trims its inputs, so per-field `safeId` would be both looser
 * and stricter. Do not move it here.
 */
export const clearSessionSchema = z.looseObject({
  conversationId: z.string().min(1),
  userId: z.string().optional(),
  agentSlug: z.string().optional(),
});

export type ClearSessionBody = z.infer<typeof clearSessionSchema>;

/**
 * `branchSession` falls through to lastUser for any mode it does not match, so
 * an unvalidated "Full" silently produced the wrong branch and answered 200.
 * `.optional()` not `.default()` — the handler keeps its own `?? "lastUser"`.
 */
export const cloneSessionSchema = z.looseObject({
  sourceConversationId: safeId,
  targetConversationId: safeId,
  branchMode: z
    .enum(["lastUser", "beforeLastUser", "full"], {
      error: "branchMode must be lastUser, beforeLastUser or full",
    })
    .optional(),
});

export type CloneSessionBody = z.infer<typeof cloneSessionSchema>;

/**
 * Path params for the /run/:sessionId control routes. Shared, because both
 * take the same single param and must constrain it the same way.
 *
 * These routes touch no filesystem; the sink is Redis — `currentOwnerPod`
 * concatenates the id into an ownership key (`run-ownership.ts` keyFor), and
 * the control message is published on a constant channel with the id as a JSON
 * value. `safeId` keeps that keyspace to the same opaque ids `/run` already
 * mints, rather than whatever arrives in the path.
 */
export const runSessionParamsSchema = z.object({
  sessionId: safeId,
});

export type RunSessionParams = z.infer<typeof runSessionParamsSchema>;

/**
 * Permissive on purpose: the caller treats ANY non-2xx as "stop the chain"
 * (webhook.ts FAIL-CLOSED), so an over-tightening here silently halts a
 * workflow rather than surfacing an error.
 */
const chainJudgeToolInvocation = z.looseObject({
  // Per-field, not whole-array: catching on the array would drop a malformed
  // entry's VALID siblings, which summarizeInvocations keeps.
  toolName: z.string().optional().catch(undefined),
  command: z.string().optional().catch(undefined),
  isError: z.boolean().optional().catch(undefined),
});

export const chainJudgeSchema = z.looseObject({
  agentResult: z.string().min(1),
  sourceAgent: z.string().min(1),
  targetAgent: z.string().min(1),
  taskTemplate: z.string().optional(),
  userQuery: z.string().optional(),
  judgeContext: z.string().optional(),
  // `.catch(undefined)` reproduces the handler's
  // `Array.isArray(x) ? x : undefined`: a non-array must not 400.
  toolInvocations: z.array(chainJudgeToolInvocation).optional().catch(undefined),
});

export type ChainJudgeBody = z.infer<typeof chainJudgeSchema>;

/**
 * `providerConfig` must NOT get `.catch(undefined)`. Discarding a malformed
 * credential config does not fail safe — resolveTarget then probes the
 * PLATFORM credentials, or returns `permanent` and stops the retry poller.
 *
 * Does not address `baseUrl` reaching fetch() with the apiKey and no host
 * allowlist: that needs an SSRF guard, not a type. Tracked separately.
 */
const probeProviderConfig = z
  .looseObject({
    apiKey: z.string().min(1),
    // Optional, unlike the ProbeProviderConfig interface: resolveTarget's gate
    // is `baseUrl || model`, so {apiKey, baseUrl} is a usable BYO target.
    model: z.string().optional(),
    // Must reject "": resolveTarget gates on `baseUrl || model` but takes the
    // base from `baseUrl ?? LITELLM.url`. The two disagree about "", producing
    // the hostless URL "/chat/completions" — caught as "capacity", so the
    // poller retries forever. Whitespace does the same.
    baseUrl: nonBlankString.optional(),
    authType: z.string().optional(),
  })
  // Catches the other half: with neither baseUrl nor model, resolveTarget
  // falls through to the PLATFORM credentials instead of the BYO ones.
  .refine((c) => Boolean(c.baseUrl || c.model), {
    error: "providerConfig needs baseUrl or model",
  });

export const providerProbeSchema = z.looseObject({
  provider: z.string().min(1),
  // `.catch(undefined)` is safe on these two — neither selects a credential,
  // and both were already dropped rather than rejected when malformed.
  model: z.string().optional().catch(undefined),
  providerConfig: probeProviderConfig.optional(),
  automation: z.boolean().optional().catch(undefined),
});

export type ProviderProbeBody = z.infer<typeof providerProbeSchema>;

/**
 * Browser-reachable (agent wizard → claw-auth proxy, which forwards req.body
 * verbatim). Both hops allow 50 MB and nothing downstream truncates, so these
 * are the first bound. 20_000 matches PROMPT_MAX_CHARS in routing-card.ts.
 * Truncate, not reject: a long prompt should not become a 400 in a wizard.
 */
export const generatePromptSchema = z.looseObject({
  intent: z.string().min(1),
  agentName: truncatedText(200).optional().catch(undefined),
  existingPrompt: truncatedText(20_000).optional().catch(undefined),
});

export type GeneratePromptBody = z.infer<typeof generatePromptSchema>;

/**
 * The optionals stay `z.unknown()`: the handler filters those arrays
 * ELEMENT-WISE, where any `z.array(...)` would reject the whole array and
 * discard the valid entries with it. `name` has no `.min(1)` — empty is
 * accepted today. No bounds: the sole caller throws on any non-2xx.
 */
export const generateRoutingCardSchema = z.looseObject({
  name: z.string(),
  systemPrompt: nonBlankString,
  description: z.unknown().optional(),
  tools: z.unknown().optional(),
  skills: z.unknown().optional(),
  asked: z.unknown().optional(),
});

export type GenerateRoutingCardBody = z.infer<typeof generateRoutingCardSchema>;

/**
 * `existingSchema`/`existingTemplate` are BOUNDED, not truncated: cutting a
 * JSON Schema mid-token hands the generator a broken draft and it returns a
 * repaired-looking contract silently missing the tail. No `.catch` either —
 * that reads as "not refining" and generates from scratch instead of failing.
 *
 * `format` stays unknown: the handler compares `=== "markdown"`, so every
 * other value already means the JSON branch. An enum would reject payloads
 * that work today.
 */
export const generateOutputFormatSchema = z.looseObject({
  description: nonBlankString,
  format: z.unknown().optional(),
  // `.nullish()`, not `.optional()`: a null short-circuits before `.trim()`
  // today and works, so rejecting it would break a caller that sends one.
  existingSchema: boundedText(20_000).nullish(),
  existingTemplate: boundedText(20_000).nullish(),
  agentName: truncatedText(200).optional().catch(undefined),
});

export type GenerateOutputFormatBody = z.infer<typeof generateOutputFormatSchema>;

/**
 * `readTools`/`writeTools` are REQUIRED with no `.catch`: the handler reads
 * `i.readTools.map(...)` with no `?? []` guard — unlike the two top-level
 * arrays — so a missing list throws in the flattening block, which runs
 * OUTSIDE the try and hangs the request.
 *
 * Leaf scalars stay unknown: they are `${}`-interpolated, and the caller fills
 * them from DB columns that may legitimately be null.
 */
const suggestToolsEntry = z.looseObject({
  name: z.unknown().optional(),
  description: z.unknown().optional(),
  riskLevel: z.unknown().optional(),
});

export const suggestToolsSchema = z.looseObject({
  intent: nonBlankString,
  catalog: z.looseObject({
    subagents: z.array(suggestToolsEntry).optional(),
    integrations: z
      .array(
        z.looseObject({
          slug: z.unknown().optional(),
          label: z.unknown().optional(),
          readTools: z.array(suggestToolsEntry),
          writeTools: z.array(suggestToolsEntry),
        }),
      )
      .optional(),
  }),
});

export type SuggestToolsBody = z.infer<typeof suggestToolsSchema>;
