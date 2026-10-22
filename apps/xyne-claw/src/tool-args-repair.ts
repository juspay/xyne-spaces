/**
 * Tool-argument repair BEFORE pi validates a call (XYNE-66597).
 *
 * pi-ai validates a call's arguments before the tool runs, so anything a tool
 * does inside execute() (e.g. sandbox-run reading `command` as `cmd`) never
 * gets the chance when the field is required. pi runs a tool's
 * `prepareArguments` first, and an error thrown there becomes the call's
 * result, so this is where:
 *
 *  - a field sent under another name is moved to the schema's name: a fixed
 *    alias list for claw's own tools, plus any key that only differs from a
 *    schema field by case or separators (`session_id` → `sessionId`);
 *  - a call still missing a required field gets an answer that helps: the
 *    values this conversation already used for that field, and an example of
 *    the arguments built from the schema. It keeps pi's "Validation failed for
 *    tool" wording so existing error stats still count it.
 *
 * `plainJsonSchema` is the type-conversion fix: pi-ai converts "5" → 5 and
 * "true" → true only for plain JSON schemas, and TypeBox's `Type.Unsafe`
 * (how claw wraps every MCP / custom tool schema) marks a schema as TypeBox,
 * which skips that step.
 */
import { currentRunMessages } from "./run-context.js";
import { metric } from "./metrics.js";

type JsonSchema = Record<string, unknown>;

const TYPEBOX_KIND = Symbol.for("TypeBox.Kind");
const MAX_EXAMPLE_CHARS = 400;
const MAX_PREVIOUS_VALUES = 3;
const MAX_VALUE_CHARS = 80;

/** Field names models send for claw's own tools, from sampled run errors. */
const TOOL_FIELD_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "search-tools": { pattern: "query", q: "query", search: "query", keywords: "query" },
  "sandbox-pw-evaluate": { expression: "function", script: "function", code: "function", js: "function" },
  "sandbox-run": { command: "cmd" },
  "sandbox-run-detached": { command: "cmd" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A plain JSON copy of a `Type.Unsafe` schema; any other schema is returned as is. */
export function plainJsonSchema<T>(schema: T): T {
  if (!isRecord(schema) || (schema as Record<symbol, unknown>)[TYPEBOX_KIND] !== "Unsafe") return schema;
  try {
    return JSON.parse(JSON.stringify(schema)) as T;
  } catch {
    return schema;
  }
}

/** Move aliased / differently-spelled fields onto the schema's names. Exported for tests. */
export function renameArgFields(
  toolName: string,
  schema: JsonSchema,
  args: Record<string, unknown>,
): { args: Record<string, unknown>; renamed: string[] } {
  const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
  const known = new Set(Object.keys(properties));
  if (known.size === 0) return { args, renamed: [] };
  const byNormalized = new Map([...known].map((k) => [normalizeKey(k), k]));
  const aliases = TOOL_FIELD_ALIASES[toolName] ?? {};
  let out = args;
  const renamed: string[] = [];
  for (const key of Object.keys(args)) {
    if (known.has(key)) continue;
    const target = aliases[key] ?? byNormalized.get(normalizeKey(key));
    if (!target || !known.has(target) || out[target] !== undefined) continue;
    if (out === args) out = { ...args };
    out[target] = out[key];
    delete out[key];
    renamed.push(`${key}→${target}`);
  }
  return { args: out, renamed };
}

function exampleValue(schema: unknown, name: string, depth: number): unknown {
  if (!isRecord(schema) || depth > 3) return `<${name}>`;
  if (Array.isArray(schema["enum"]) && schema["enum"].length > 0) return schema["enum"][0];
  if (Array.isArray(schema["examples"]) && schema["examples"].length > 0) return schema["examples"][0];
  if (schema["default"] !== undefined) return schema["default"];
  const variants = (schema["anyOf"] ?? schema["oneOf"]) as unknown;
  if (Array.isArray(variants) && variants.length > 0) return exampleValue(variants[0], name, depth);
  const type = Array.isArray(schema["type"]) ? schema["type"].find((t) => t !== "null") : schema["type"];
  switch (type) {
    case "object":
      return exampleObject(schema, depth + 1);
    case "array":
      return [exampleValue(schema["items"], name, depth + 1)];
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    default:
      return `<${name}>`;
  }
}

function exampleObject(schema: JsonSchema, depth: number): Record<string, unknown> {
  const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
  const required = Array.isArray(schema["required"]) ? (schema["required"] as unknown[]).filter((k): k is string => typeof k === "string") : [];
  const keys = required.length > 0 ? required : Object.keys(properties).slice(0, 3);
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = exampleValue(properties[key], key, depth);
  return out;
}

/** Example arguments built from a schema, or undefined when it would be too long to help. */
export function schemaExample(schema: unknown): string | undefined {
  if (!isRecord(schema)) return undefined;
  const text = JSON.stringify(exampleObject(schema, 0));
  return text.length > 2 && text.length <= MAX_EXAMPLE_CHARS ? text : undefined;
}

/**
 * A schema whose required fields include an object or a list of objects —
 * the shapes models get wrong most, and the only ones worth an example in
 * the tool description.
 */
export function hasNestedRequiredShape(schema: unknown): boolean {
  if (!isRecord(schema) || !isRecord(schema["properties"])) return false;
  const properties = schema["properties"];
  const required = Array.isArray(schema["required"]) ? (schema["required"] as unknown[]) : [];
  return required.some((key) => {
    const prop = typeof key === "string" ? properties[key] : undefined;
    if (!isRecord(prop)) return false;
    if (prop["type"] === "object") return true;
    return prop["type"] === "array" && isRecord(prop["items"]) && prop["items"]["type"] === "object";
  });
}

/** Values earlier tool calls in this conversation passed for `field`, newest first. */
export function previousValues(field: string, messages: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && seen.size < MAX_PREVIOUS_VALUES; i -= 1) {
    const message = messages[i];
    if (!isRecord(message) || message["role"] !== "assistant" || !Array.isArray(message["content"])) continue;
    for (const block of message["content"] as unknown[]) {
      if (!isRecord(block) || block["type"] !== "toolCall" || !isRecord(block["arguments"])) continue;
      const value = block["arguments"][field];
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
      const text = JSON.stringify(value);
      if (text.length <= MAX_VALUE_CHARS + 2 && text !== '""') seen.add(text);
      if (seen.size >= MAX_PREVIOUS_VALUES) break;
    }
  }
  return [...seen];
}

/** The answer to a call missing required fields. Exported for tests. */
export function missingFieldsMessage(
  toolName: string,
  missing: string[],
  schema: JsonSchema,
  args: Record<string, unknown>,
  messages: readonly unknown[],
): string {
  const lines = [`Validation failed for tool "${toolName}":`];
  for (const field of missing) lines.push(`  - ${field}: must have required property '${field}'`);
  const hints: string[] = [];
  for (const field of missing) {
    const values = previousValues(field, messages);
    if (values.length > 0) hints.push(`Values used earlier in this conversation for ${field}: ${values.join(", ")}`);
  }
  const example = schemaExample(schema);
  if (example) hints.push(`Example arguments: ${example}`);
  if (hints.length > 0) lines.push("", ...hints);
  lines.push("", "Received arguments:", JSON.stringify(args, null, 2));
  return lines.join("\n");
}

/**
 * pi `prepareArguments` for one tool: rename fields, then answer a call that
 * is still missing required fields. Anything else is left to pi's validator.
 */
export function makePrepareArguments(
  toolName: string,
  schema: unknown,
  inner?: (args: unknown) => unknown,
): (args: unknown) => unknown {
  return (raw: unknown) => {
    const prepared = inner ? inner(raw) : raw;
    if (!isRecord(schema) || !isRecord(prepared)) return prepared;
    const { args, renamed } = renameArgFields(toolName, schema, prepared);
    if (renamed.length > 0) metric.count("tool_call_repair", { repair: "field_alias", tool: toolName });
    const required = Array.isArray(schema["required"])
      ? (schema["required"] as unknown[]).filter((k): k is string => typeof k === "string")
      : [];
    const missing = required.filter((field) => args[field] === undefined);
    if (missing.length > 0) {
      throw new Error(missingFieldsMessage(toolName, missing, schema, args, currentRunMessages()));
    }
    return args;
  };
}
