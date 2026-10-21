import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  hashPromptText,
  hashServerPackage,
  hashSkillBundle,
  hashToolDefinition,
  sha256Hex,
  skillBundleCanonicalString,
  type SkillBundleInput,
  type SkillFileInput,
} from "./canonical.js";

const utf8 = (s: string) => new TextEncoder().encode(s);
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("canonicalJson", () => {
  it.each<[string, unknown, string]>([
    ["key order", { b: 1, a: { d: 1, c: 2 } }, '{"a":{"c":2,"d":1},"b":1}'],
    ["nested", { z: [3, { y: [], x: {} }, "s"], a: null, t: true }, '{"a":null,"t":true,"z":[3,{"x":{},"y":[]},"s"]}'],
    ["control characters", "\u0000\u001f\b\t\n\f\r\"\\", String.raw`"\u0000\u001f\b\t\n\f\r\"\\"`],
    ["non-ASCII stays literal", "é€😀", '"é€😀"'],
    ["lone surrogate", "\ud800", String.raw`"\ud800"`],
    ["1e21", 1e21, "1e+21"],
    ["0.1", 0.1, "0.1"],
    ["-0", -0, "0"],
  ])("%s", (_name, value, expected) => expect(canonicalJson(value)).toBe(expected));

  it("sorts keys by UTF-16 code units, not code points (RFC 8785 sample)", () => {
    const sorted = ["\r", "1", "\u0080", "ö", "€", "\u{1F600}", "דּ"];
    const scrambled = [...sorted.slice(3), ...sorted.slice(0, 3)].reverse();
    const input = Object.fromEntries(scrambled.map((k) => [k, null]));
    expect(canonicalJson(input)).toBe(`{${sorted.map((k) => `${JSON.stringify(k)}:null`).join(",")}}`);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["function", () => 1],
    ["symbol", Symbol("s")],
    ["bigint", 1n],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["nested undefined", { a: [1, { b: undefined }] }],
    ["nested NaN", [[NaN]]],
    ["array hole", [1, , 2]],
    ["Map", new Map()],
    ["Date", new Date(0)],
  ])("rejects %s", (_name, value) => expect(() => canonicalJson(value)).toThrow(TypeError));
});

describe("sha256Hex", () => {
  it("matches the empty vector and hashes strings as UTF-8", () => {
    expect(sha256Hex("")).toBe(EMPTY);
    expect(sha256Hex(new Uint8Array())).toBe(EMPTY);
    expect(sha256Hex("é€😀")).toBe(sha256Hex(utf8("é€😀")));
  });
});

describe("hashPromptText", () => {
  const h = hashPromptText;

  it("pins the digest and changes CRLF to LF and nothing else", () => {
    expect(h("hello\r\nworld\n")).toBe("4a1e67f2fe1d1cc7b31d0ca2ec441da4778203a036a77da10344c85e24ff0f92");
    expect(h("hello\nworld\n")).toBe(h("hello\r\nworld\n"));
    expect(h("a\rb")).not.toBe(h("a\nb"));
    expect(h("a\r\r\nb")).not.toBe(h("a\nb"));
  });

  it("keeps Unicode form and a BOM", () => {
    expect(h("é")).not.toBe(h("é"));
    expect(h("﻿a")).not.toBe(h("a"));
  });
});

describe("hashToolDefinition", () => {
  const h = hashToolDefinition;
  const def = {
    name: "get_weather",
    title: "Get weather",
    description: "Weather for a city.",
    inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  };

  it("pins the digest", () => {
    expect(h(def)).toBe("42e967ebacd1dc03b7b2d8b4306700454ee0361ccf2a5b407f56c3a4dd266337");
  });

  it("ignores key order, undefined values and fields outside the six", () => {
    const reordered = {
      annotations: def.annotations,
      outputSchema: def.outputSchema,
      inputSchema: { required: ["city"], properties: { city: { type: "string" } }, type: "object" },
      description: def.description,
      title: def.title,
      name: def.name,
    };
    expect(h(reordered)).toBe(h(def));
    expect(h({ name: "t", title: undefined, inputSchema: undefined })).toBe(h({ name: "t" }));
    const withExtras = { name: "t", _meta: { x: 1 }, icons: [{ src: "i" }] };
    expect(h(withExtras)).toBe(h({ name: "t" }));
  });

  it("changes with each of the six fields", () => {
    for (const key of Object.keys(def)) expect(h({ ...def, [key]: "changed" })).not.toBe(h(def));
  });

  it("rejects a missing name and values with no JSON form", () => {
    expect(() => h({} as never)).toThrow(TypeError);
    expect(() => h({ name: "t", inputSchema: { n: NaN } })).toThrow(TypeError);
  });
});

describe("hashSkillBundle", () => {
  const file = (path: string, body: string, extra: Partial<SkillFileInput> = {}): SkillFileInput => ({
    path,
    bytes: utf8(body),
    ...extra,
  });
  const bundle = (files: SkillFileInput[], extra: Partial<SkillBundleInput> = {}): SkillBundleInput => ({
    name: "demo",
    description: "Demo skill",
    skillMd: "# Demo\r\nRun it.\r\n",
    files,
    ...extra,
  });
  const FILES: SkillFileInput[] = [
    file("scripts/run.sh", "echo hi\n", { executable: true }),
    file("README.md", "readme\n"),
    file(".env.example", "KEY=\n"),
    { path: "latest", symlinkTarget: "README.md" },
  ];
  const swap = (path: string, next: SkillFileInput) => FILES.map((f) => (f.path === path ? next : f));
  const base = hashSkillBundle(bundle(FILES));

  it("pins the canonical string and digest", () => {
    const d = sha256Hex;
    expect(skillBundleCanonicalString(bundle(FILES))).toBe(
      '{"description":"Demo skill","files":[' +
        `{"executable":0,"path":".env.example","sha256":"${d("KEY=\n")}"},` +
        `{"executable":0,"path":"README.md","sha256":"${d("readme\n")}"},` +
        '{"path":"latest","symlink":"README.md"},' +
        `{"executable":1,"path":"scripts/run.sh","sha256":"${d("echo hi\n")}"}` +
        '],"name":"demo","skillMd":"# Demo\\nRun it.\\n"}',
    );
    expect(base).toBe("5ac35596307d33ce1a2af17e22126441b7b7c9b38b5e64a758662f11b049a97e");
  });

  it("sorts paths by UTF-16 code units", () => {
    const paths = ["～", "b", "\u{1F600}", "A"];
    const out = skillBundleCanonicalString(bundle(paths.map((p) => file(p, "x"))));
    expect([...out.matchAll(/"path":"([^"]+)"/g)].map((m) => m[1])).toEqual(["A", "b", "\u{1F600}", "～"]);
  });

  it("ignores file order and accepts bytes or their sha256 alike", () => {
    expect(hashSkillBundle(bundle([...FILES].reverse()))).toBe(base);
    const byDigest = FILES.map((f) => (f.bytes ? { ...f, bytes: undefined, sha256: sha256Hex(f.bytes) } : f));
    expect(hashSkillBundle(bundle(byDigest))).toBe(base);
    expect(hashSkillBundle(bundle([file("e", "")]))).toBe(hashSkillBundle(bundle([{ path: "e", sha256: EMPTY }])));
  });

  it.each<[string, SkillBundleInput]>([
    ["the executable bit", bundle(swap("scripts/run.sh", file("scripts/run.sh", "echo hi\n")))],
    ["a dotfile removed", bundle(FILES.filter((f) => f.path !== ".env.example"))],
    ["a dotfile edited", bundle(swap(".env.example", file(".env.example", "KEY=1\n")))],
    ["a symlink target", bundle(swap("latest", { path: "latest", symlinkTarget: "scripts/run.sh" }))],
    ["the name", bundle(FILES, { name: "other" })],
    ["the description", bundle(FILES, { description: "other" })],
    ["SKILL.md", bundle(FILES, { skillMd: "# Demo\nRun it!\n" })],
  ])("changes with %s", (_name, changed) => expect(hashSkillBundle(changed)).not.toBe(base));

  it("hashes a symlink differently from a regular file at the same path", () => {
    const link = bundle([{ path: "x", symlinkTarget: "y" }]);
    expect(hashSkillBundle(link)).not.toBe(hashSkillBundle(bundle([file("x", "y")])));
  });

  it.each(["a/../b", "/abs", "a\\b", "./a", "a//b", "a/", "", "a\0b"])("rejects the path %j", (p) => {
    expect(() => hashSkillBundle(bundle([file(p, "x")]))).toThrow(TypeError);
    expect(() => hashSkillBundle(bundle([file(p, "x")]))).toThrow(JSON.stringify(p));
  });

  it.each([
    ["the same path", "a.md", "a.md"],
    ["paths that differ by case", "A.md", "a.md"],
    ["paths that differ by Unicode form", "é.md", "é.md"],
  ])("rejects %s", (_name, p, q) => {
    expect(() => hashSkillBundle(bundle([file(p, "1"), file(q, "2")]))).toThrow(JSON.stringify(q));
  });

  it.each<[string, SkillFileInput]>([
    ["no content source", { path: "a" }],
    ["two content sources", { path: "a", bytes: utf8("x"), sha256: sha256Hex("x") }],
    ["an uppercase sha256", { path: "a", sha256: sha256Hex("x").toUpperCase() }],
  ])("rejects %s", (_name, f) => expect(() => hashSkillBundle(bundle([f]))).toThrow(TypeError));
});

describe("hashServerPackage", () => {
  const h = hashServerPackage;
  const pkg = { integrity: "sha512-AAAA", command: "npx", args: ["-y", "@acme/mcp@1.2.3"], envKeys: ["B_TOKEN", "A_URL"] };

  it("pins the digest", () => {
    expect(h(pkg)).toBe("f1ed0ba570fdc6ec2746490b8b6c314b2e4b45abffce3384a36675d335269756");
  });

  it("ignores env key order and repeats, and never sees values", () => {
    expect(h({ ...pkg, envKeys: ["A_URL", "B_TOKEN", "A_URL"] })).toBe(h(pkg));
    const withValue = (value: string) => ({ ...pkg, env: { A_URL: value } });
    expect(h(withValue("one"))).toBe(h(withValue("two")));
  });

  it.each<[string, Partial<typeof pkg> & { digest?: string }]>([
    ["the integrity hash", { integrity: "sha512-BBBB" }],
    ["an image digest", { digest: "sha256:1" }],
    ["the command", { command: "uvx" }],
    ["the argument order", { args: ["@acme/mcp@1.2.3", "-y"] }],
    ["an env key name", { envKeys: ["A_URL", "C_TOKEN"] }],
  ])("changes with %s", (_name, patch) => expect(h({ ...pkg, ...patch })).not.toBe(h(pkg)));
});
