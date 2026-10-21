import { createHash } from "node:crypto";

export interface ToolDefinitionInput {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

export interface SkillFileInput {
  path: string;
  executable?: boolean | undefined;
  sha256?: string | undefined;
  bytes?: Uint8Array | undefined;
  symlinkTarget?: string | undefined;
}

export interface SkillBundleInput {
  name: string;
  description: string;
  skillMd: string;
  files: readonly SkillFileInput[];
}

export interface ServerPackageInput {
  digest?: string | undefined;
  integrity?: string | undefined;
  command: string;
  args: readonly string[];
  envKeys: readonly string[];
}

type SkillEntry = { path: string; executable: 0 | 1; sha256: string } | { path: string; symlink: string };

const SHA256_HEX = /^[0-9a-f]{64}$/;

// Prototype check works across realms; a Map or Date would otherwise hash as {} or a string.
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** RFC 8785 (JCS). Throws TypeError on anything that has no JSON form, cycles and depth past 64 included. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: NaN and Infinity have no JSON form");
    return JSON.stringify(value);
  }
  if (depth > 64) throw new TypeError("canonicalJson: nesting deeper than 64");
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) items.push(canonicalJson(value[i], depth + 1));
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object" && isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    const members = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k], depth + 1)}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError(`canonicalJson: cannot serialise ${typeof value}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

const present = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

export function hashToolDefinition(def: ToolDefinitionInput): string {
  const optional = present({
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    annotations: def.annotations,
  });
  return sha256Hex(canonicalJson({ name: def.name, ...optional }));
}

// One pass on purpose: a stray CR before a CRLF must keep changing the hash.
export function normalizePromptText(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

export function hashPromptText(text: string): string {
  return sha256Hex(normalizePromptText(text));
}

function skillEntry(file: SkillFileInput): SkillEntry {
  const { path } = file;
  if (path.includes("\\") || path.includes("\0") || path.split("/").some((s) => s === "" || s === "." || s === ".."))
    throw new TypeError(`skill bundle: invalid path ${JSON.stringify(path)}`);
  if ([file.sha256, file.bytes, file.symlinkTarget].filter((v) => v !== undefined).length !== 1)
    throw new TypeError(`skill bundle: ${JSON.stringify(path)} needs exactly one of sha256, bytes, symlinkTarget`);
  if (file.symlinkTarget !== undefined) return { path, symlink: file.symlinkTarget };
  const sha256 = file.bytes ? sha256Hex(file.bytes) : file.sha256;
  if (!sha256 || !SHA256_HEX.test(sha256)) throw new TypeError(`skill bundle: ${JSON.stringify(path)} has a malformed sha256`);
  return { path, executable: file.executable ? 1 : 0, sha256 };
}

export function skillBundleCanonicalString(bundle: SkillBundleInput): string {
  const seen = new Set<string>();
  const files = bundle.files.map((file) => {
    const entry = skillEntry(file);
    // The filesystems that fold case or Unicode form would merge such paths into one file.
    const key = file.path.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new TypeError(`skill bundle: duplicate path ${JSON.stringify(file.path)}`);
    seen.add(key);
    return entry;
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return canonicalJson({
    name: bundle.name,
    description: bundle.description,
    skillMd: normalizePromptText(bundle.skillMd),
    files,
  });
}

export function hashSkillBundle(bundle: SkillBundleInput): string {
  return sha256Hex(skillBundleCanonicalString(bundle));
}

export function hashServerPackage(pkg: ServerPackageInput): string {
  return sha256Hex(
    canonicalJson({
      ...present({ digest: pkg.digest, integrity: pkg.integrity }),
      command: pkg.command,
      args: pkg.args,
      envKeys: [...new Set(pkg.envKeys)].sort(),
    }),
  );
}
