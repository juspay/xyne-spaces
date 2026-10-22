import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { validateToolArguments } from "@earendil-works/pi-ai";
import {
  hasNestedRequiredShape,
  makePrepareArguments,
  missingFieldsMessage,
  plainJsonSchema,
  previousValues,
  renameArgFields,
  schemaExample,
} from "../src/tool-args-repair.js";

const schema = {
  type: "object",
  properties: {
    sessionId: { type: "string" },
    cmd: { type: "string" },
    timeoutMs: { type: "number" },
  },
  required: ["cmd"],
};

describe("plainJsonSchema", () => {
  it("lets pi convert string numbers for an MCP-style schema", () => {
    const call = { type: "toolCall" as const, id: "1", name: "t", arguments: { cmd: "ls", timeoutMs: "5000" } };
    // Type.Unsafe: pi skips its JSON-schema conversion and rejects "5000".
    const unsafe = { name: "t", description: "", parameters: Type.Unsafe(schema) };
    expect(() => validateToolArguments(unsafe as never, call)).toThrow(/timeoutMs/);
    // Plain copy: "5000" becomes 5000.
    const plain = { name: "t", description: "", parameters: plainJsonSchema(Type.Unsafe(schema)) };
    expect(validateToolArguments(plain as never, call)).toEqual({ cmd: "ls", timeoutMs: 5000 });
  });

  it("leaves TypeBox-built schemas alone", () => {
    const built = Type.Object({ a: Type.String() });
    expect(plainJsonSchema(built)).toBe(built);
  });
});

describe("renameArgFields", () => {
  it("moves a known alias onto the schema field", () => {
    expect(renameArgFields("sandbox-run", schema, { command: "ls" })).toEqual({ args: { cmd: "ls" }, renamed: ["command→cmd"] });
    const searchSchema = { type: "object", properties: { query: { type: "string" } } };
    expect(renameArgFields("search-tools", searchSchema, { pattern: "alert" }).args).toEqual({ query: "alert" });
  });

  it("moves a key that differs only by case or separators", () => {
    expect(renameArgFields("any", schema, { session_id: "s1", cmd: "ls" }).args).toEqual({ sessionId: "s1", cmd: "ls" });
  });

  it("never overwrites a field the call already set", () => {
    const args = { command: "rm", cmd: "ls" };
    expect(renameArgFields("sandbox-run", schema, args)).toEqual({ args, renamed: [] });
  });
});

describe("missing required fields", () => {
  const messages = [
    { role: "assistant", content: [{ type: "toolCall", id: "a", name: "bb__list_prs", arguments: { workspace: "juspay", repo: "hyperswitch" } }] },
    { role: "toolResult", content: [] },
    { role: "assistant", content: [{ type: "toolCall", id: "b", name: "bb__get_pr", arguments: { workspace: "xyne" } }] },
  ];

  it("collects earlier values, newest first", () => {
    expect(previousValues("workspace", messages)).toEqual(['"xyne"', '"juspay"']);
    expect(previousValues("missing", messages)).toEqual([]);
  });

  it("keeps pi's wording and adds earlier values and an example", () => {
    const prSchema = {
      type: "object",
      properties: { workspace: { type: "string" }, repo: { type: "string" }, state: { type: "string", enum: ["OPEN", "MERGED"] } },
      required: ["workspace", "repo", "state"],
    };
    const text = missingFieldsMessage("bb__get_pr", ["workspace"], prSchema, { repo: "x", state: "OPEN" }, messages);
    expect(text).toMatch(/^Validation failed for tool "bb__get_pr":\n {2}- workspace: must have required property 'workspace'/);
    expect(text).toContain('Values used earlier in this conversation for workspace: "xyne", "juspay"');
    expect(text).toContain('Example arguments: {"workspace":"<workspace>","repo":"<repo>","state":"OPEN"}');
  });

  it("prepareArguments renames first, then rejects only what is still missing", () => {
    const prepare = makePrepareArguments("sandbox-run", schema);
    expect(prepare({ command: "ls" })).toEqual({ cmd: "ls" });
    expect(() => prepare({ timeoutMs: 5 })).toThrow(/^Validation failed for tool "sandbox-run":\n {2}- cmd: must have required property 'cmd'/);
  });
});

describe("schema examples", () => {
  const nested = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, type: { type: "string", enum: ["single", "multi"] }, label: { type: "string" } },
          required: ["id", "type", "label"],
        },
      },
    },
    required: ["questions"],
  };

  it("builds the nested shape a model must send", () => {
    expect(schemaExample(nested)).toBe('{"questions":[{"id":"<id>","type":"single","label":"<label>"}]}');
  });

  it("flags only schemas with a required object or list of objects", () => {
    expect(hasNestedRequiredShape(nested)).toBe(true);
    expect(hasNestedRequiredShape(schema)).toBe(false);
  });
});
