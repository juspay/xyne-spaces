import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-tool-call context, set by the outermost tool wrapper and visible to
 * everything the call does (including the MCP tool's own inner result
 * processing). Lets result sifting know the call's arguments and the model's
 * per-call `sift` choice without threading them through every signature, and
 * lets the two result-processing passes an MCP result goes through agree that
 * it was already sifted once.
 */
export interface ToolCallContext {
  tool: string;
  args: unknown;
  /** The model's per-call choice; undefined = use the agent's default. */
  sift?: boolean;
  /** Set once the result has been sifted, so a second pass leaves it alone. */
  sifted?: boolean;
}

const store = new AsyncLocalStorage<ToolCallContext>();

export function runWithToolCall<T>(ctx: ToolCallContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function currentToolCall(): ToolCallContext | undefined {
  return store.getStore();
}

/** The model-visible per-call switch added to tool schemas when result sifting is on. */
export const SIFT_PARAM = "sift";

export const SIFT_PARAM_SCHEMA = {
  type: "boolean",
  description:
    "Optional. Relevance filter for a large list result: true = return only the items relevant to this conversation, " +
    "false = return the raw, unfiltered result. Omit to use the agent's default. The full result is always saved to a file.",
} as const;

/**
 * Add the `sift` switch to a tool's JSON-schema parameters. Returns the input
 * unchanged when it is not an object schema or already has the property.
 * Spreads own properties (TypeBox's symbol-keyed Kind included).
 */
export function withSiftParam<T>(parameters: T): T {
  const p = parameters as unknown as { type?: unknown; properties?: Record<string, unknown> };
  if (!p || typeof p !== "object" || p.type !== "object") return parameters;
  if (p.properties && SIFT_PARAM in p.properties) return parameters;
  return { ...(parameters as object), properties: { ...(p.properties ?? {}), [SIFT_PARAM]: SIFT_PARAM_SCHEMA } } as T;
}

/** Split the harness-only `sift` field out of a call's params. */
export function takeSiftParam(params: unknown): { params: unknown; sift?: boolean } {
  if (!params || typeof params !== "object" || Array.isArray(params) || !(SIFT_PARAM in params)) return { params };
  const { [SIFT_PARAM]: raw, ...rest } = params as Record<string, unknown>;
  const sift = raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : undefined;
  return sift === undefined ? { params: rest } : { params: rest, sift };
}
