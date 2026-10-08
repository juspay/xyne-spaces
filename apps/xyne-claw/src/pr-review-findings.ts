import { z } from "zod";

export const REVIEW_SEVERITIES = ["hi", "med", "low"] as const;

export const reviewFindingSchema = z.object({
  id: z.string().min(1).max(24),
  sev: z.enum(REVIEW_SEVERITIES),
  weight: z.boolean().optional(),
  integration: z.boolean().optional(),
  unverified: z.boolean().optional(),
  title: z.string().min(1).max(200),
  file: z.string().min(1).max(400),
  loc: z.string().min(1).max(300),
  what: z.string().min(1).max(2000),
  why: z.string().min(1).max(4000),
  blast: z.string().min(1).max(1000),
  history: z.string().max(2000).optional(),
  note: z.string().max(2000).optional(),
  ask: z.string().min(1).max(2000),
});

export const reviewFindingsSchema = z.array(reviewFindingSchema).min(1).max(24);

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/**
 * JSON Schema handed to `buildSubmitResultTool` VERBATIM as the submit-result
 * tool's input schema, so the provider constrains the tool-call arguments and
 * the model cannot emit a malformed payload in the first place.
 *
 * The root is an ARRAY, which buildSubmitResultTool wraps as
 * `{ result: <this schema> }` to keep the tool signature an object — and then
 * unwraps `result` before writing `ref.value`. So the value this module is
 * asked to coerce is the bare array. `coerceFindings` still tolerates the
 * wrapper shape in case an upstream change stops unwrapping.
 */
export const REVIEW_FINDINGS_JSON_SCHEMA: Record<string, unknown> = {
  type: "array",
  minItems: 1,
  maxItems: 24,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "sev", "title", "file", "loc", "what", "why", "blast", "ask"],
    properties: {
      id: { type: "string", description: "Short unique slug, e.g. \"f1\"." },
      sev: {
        type: "string",
        enum: [...REVIEW_SEVERITIES],
        description: "Reviewer attention, not defect certainty.",
      },
      weight: {
        type: "boolean",
        description: "True for the one or two findings that dominate the review.",
      },
      integration: {
        type: "boolean",
        description: "True when the file already existed before this PR.",
      },
      unverified: {
        type: "boolean",
        description:
          "True when you DECIDED this but could not VERIFY it from the ground truth or from files you read. Unverified findings are the only ones that reach the reviewer's unknowns wall.",
      },
      title: { type: "string", description: "A claim, not a label." },
      file: { type: "string", description: "One of the exact paths in the ground truth." },
      loc: {
        type: "string",
        description: "Line refs ONLY from ground truth, e.g. \"+9 · installed at path/to/site.ts:151\".",
      },
      what: { type: "string", description: "What changed, one sentence. May contain <code>/<b>/<i>." },
      why: { type: "string", description: "Why a reviewer should care; name the install site or the sibling." },
      blast: { type: "string", description: "Who else runs through this now." },
      history: { type: "string", description: "Optional. Shas + subjects from ground truth only." },
      note: { type: "string", description: "Optional. What the author's own comment or description claims." },
      ask: { type: "string", description: "The question to put to the author." },
    },
  },
};

export function coerceFindings(
  payload: unknown,
): { ok: true; findings: ReviewFinding[] } | { ok: false; error: string } {
  const candidate =
    Array.isArray(payload) || !payload || typeof payload !== "object"
      ? payload
      : ((payload as Record<string, unknown>)["result"] ??
        (payload as Record<string, unknown>)["findings"] ??
        payload);
  const result = reviewFindingsSchema.safeParse(candidate);
  if (result.success) return { ok: true, findings: result.data };
  return {
    ok: false,
    error: result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; "),
  };
}
