/**
 * create-app — the agent authors a small multi-file React project
 * that the dashboard renders in a Sandpack frame.
 *
 * Wire format mirrors create-ppt: the FULL project rides the attachment bytes
 * (base64 JSON → GCS), while a SMALL manifest goes in the trailing marker so it
 * lands on ChatAttachment.metadata. Attachment metadata is the only channel here
 * immune to pi-coding-agent's truncation of tool results, and keeping the
 * manifest small matters because it is the payload replayed on history reload.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import {
  ALLOWED_AST_MODELS,
  ALLOWED_AST_OPERATIONS,
  ALLOWED_NAMED_QUERIES,
  MAX_AST_TAKE,
  MAX_AST_WHERE_DEPTH,
  MAX_DATA_REQUIREMENTS,
  type ArtifactDataSource,
  type ReactArtifactDataRequirement,
} from "./dataSources.js";

export type { ArtifactDataSource, ReactArtifactDataRequirement } from "./dataSources.js";

const ARTIFACT_MIME = "application/json";
const ARTIFACT_FILENAME = "artifact.json";

/** Delimiters used to expose the artifact manifest back to the agent runtime.
 *  Intentionally still REACT_ARTIFACT_*: this is the wire contract with
 *  custom-tools.ts and the key under which every existing attachment's manifest
 *  is already persisted. The tool's user-facing name is independent of it. */
const MANIFEST_START = "REACT_ARTIFACT_START";
const MANIFEST_END = "REACT_ARTIFACT_END";

/** Bumped when the on-disk artifact payload shape changes. */
const ARTIFACT_VERSION = 1;

const MAX_FILES = 20;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
/** The summary is the only part the model re-reads; keep it well under the 32KB inline cap. */
const MAX_SUMMARY_CHARS = 1000;
const MAX_TITLE_CHARS = 120;

const ALLOWED_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"] as const;

/**
 * Packages known to work in the preview, surfaced to the model as suggestions.
 *
 * NOT enforced: see ENFORCE_DEPENDENCY_ALLOWLIST. The mechanism is kept because
 * a curated set is the obvious lever if arbitrary installs later prove to be a
 * problem (bundle time, packages needing a build step or node built-ins,
 * typosquats) — flipping the flag re-enables it without rework.
 */
const SUGGESTED_DEPENDENCIES = new Set([
  "react",
  "react-dom",
  "recharts",
  "lucide-react",
  "date-fns",
  "clsx",
  "class-variance-authority",
  "tailwind-merge",
  "@radix-ui/react-accordion",
  "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-label",
  "@radix-ui/react-popover",
  "@radix-ui/react-progress",
  "@radix-ui/react-scroll-area",
  "@radix-ui/react-select",
  "@radix-ui/react-separator",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "@radix-ui/react-tooltip",
]);

/**
 * When true, `dependencies` is restricted to SUGGESTED_DEPENDENCIES. Off: the
 * agent may install anything on npm, so it is not blocked from building what
 * the user asked for by a list nobody remembered to update.
 */
const ENFORCE_DEPENDENCY_ALLOWLIST = false;

/** npm naming rules, so a malformed name fails here rather than at install. */
const NPM_PACKAGE_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Injected into every project by the renderer, so the agent must NOT author
 * them — a file at one of these paths would shadow the real primitive. Listed
 * here to keep the tool description and the renderer's preamble in step.
 */
const SHADCN_UI_COMPONENTS = [
  "accordion", "alert", "avatar", "badge", "button", "card", "checkbox",
  "dialog", "dropdown-menu", "input", "label", "popover", "progress",
  "scroll-area", "select", "separator", "sheet", "skeleton", "switch",
  "table", "tabs", "textarea", "tooltip",
] as const;

const RESERVED_PATH_PREFIXES = ["/components/ui/", "/lib/utils", "/lib/xyne-data", "/public/"] as const;

/** Agent slugs an app may name. A short list: this is a preference, not a menu —
 *  the viewer's own access is always the real ceiling. */
const MAX_DECLARED_AGENTS = 4;
const AGENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ReactArtifactFile {
  path: string;
  content: string;
}

/** Full payload persisted to object storage and fed to Sandpack. */
export interface ReactArtifactPayload {
  version: number;
  title: string;
  entry: string;
  template: "react-ts";
  files: ReactArtifactFile[];
  dependencies: Record<string, string>;
  dataRequirements: ReactArtifactDataRequirement[];
  /** Set when the app calls useXyneMutate. Drives a UI badge only — it grants
   *  nothing, since any mutation the viewer may perform is callable. */
  writes?: boolean;
  /** Set when the app calls useXyneAgent. Drives a UI badge only. */
  invokesAgents?: boolean;
  /** Agents the app prefers, by slug. NARROWING only: the run is authorized
   *  against what the viewer can reach, so naming an agent here can never grant
   *  access to it. Absent/empty means "any agent the viewer can reach". */
  agents?: string[];
}

/** Small descriptor persisted to ChatAttachment.metadata and rendered by the inline card. */
export interface ReactArtifactManifest {
  version: number;
  title: string;
  entry: string;
  fileCount: number;
  files: string[];
  dependencies: string[];
  dataRequirements: ReactArtifactDataRequirement[];
  writes?: boolean;
  invokesAgents?: boolean;
  agents?: string[];
}

/**
 * Strip NUL and other C0 control characters (keeping tab/newline/carriage
 * return). Postgres `jsonb` rejects U+0000 outright, and the manifest lands in
 * a jsonb column.
 */
function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message);
}

function validatePath(path: string): void {
  if (!path.startsWith("/")) fail(`File path "${path}" must start with "/".`);
  if (path.includes("..")) fail(`File path "${path}" must not contain "..".`);
  if (path.includes("//")) fail(`File path "${path}" must not contain "//".`);
  if (path.includes("\\")) fail(`File path "${path}" must use forward slashes.`);
  if (!/^\/[\w./-]+$/.test(path)) {
    fail(`File path "${path}" may only contain letters, digits, "_", "-", "." and "/".`);
  }
  const reserved = RESERVED_PATH_PREFIXES.find((prefix) => path.startsWith(prefix));
  if (reserved) {
    fail(
      `File path "${path}" is reserved — shadcn/ui and the Tailwind setup are provided ` +
        `automatically. Import them instead of writing them.`,
    );
  }
  if (!ALLOWED_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    fail(`File path "${path}" must end with one of: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  }
}

function parseFiles(raw: unknown): ReactArtifactFile[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail("`files` must be a non-empty array of {path, content}.");
  }
  if (raw.length > MAX_FILES) {
    fail(`Too many files: ${raw.length}. The limit is ${MAX_FILES}.`);
  }

  const files: ReactArtifactFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const entry of raw) {
    const path = asString((entry as ReactArtifactFile | undefined)?.path).trim();
    const content = stripControlChars(asString((entry as ReactArtifactFile | undefined)?.content));
    if (!path) fail("Every file needs a non-empty `path`.");
    validatePath(path);
    if (seen.has(path)) fail(`Duplicate file path "${path}".`);
    seen.add(path);

    const size = byteLength(content);
    if (size > MAX_FILE_BYTES) {
      fail(`File "${path}" is ${size} bytes; the per-file limit is ${MAX_FILE_BYTES}.`);
    }
    totalBytes += size;
    files.push({ path, content });
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    fail(`Project is ${totalBytes} bytes; the total limit is ${MAX_TOTAL_BYTES}.`);
  }
  return files;
}

function parseDependencies(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    fail("`dependencies` must be an object mapping package name to version.");
  }

  const deps: Record<string, string> = {};
  for (const [name, version] of Object.entries(raw as Record<string, unknown>)) {
    if (!NPM_PACKAGE_NAME_RE.test(name)) {
      fail(`"${name}" is not a valid npm package name.`);
    }
    if (ENFORCE_DEPENDENCY_ALLOWLIST && !SUGGESTED_DEPENDENCIES.has(name)) {
      fail(
        `Dependency "${name}" is not allowed. Allowed packages: ` +
          `${[...SUGGESTED_DEPENDENCIES].sort().join(", ")}.`,
      );
    }
    const v = asString(version).trim();
    if (!v) fail(`Dependency "${name}" needs a version (use "latest" if unsure).`);
    deps[name] = v;
  }
  return deps;
}

const REQUIREMENT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type ArtifactAstOrderBy = Record<string, unknown> | Array<Record<string, unknown>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Depth of nested objects, mirroring the server's MAX_WHERE_DEPTH check. */
function objectDepth(value: unknown, depth = 1): number {
  if (!value || typeof value !== "object") return depth - 1;
  let deepest = depth;
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === "object") {
      deepest = Math.max(deepest, objectDepth(child, depth + 1));
    }
  }
  return deepest;
}

function parseDataSource(raw: unknown, reqName: string): ArtifactDataSource | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) {
    fail(`\`source\` for requirement "${reqName}" must be an object.`);
  }

  const kind = asString(raw["kind"]).trim();

  if (kind === "query") {
    const query = asString(raw["query"]).trim();
    if (!ALLOWED_NAMED_QUERIES[query]) {
      fail(
        `Data source "${query || "(missing)"}" for requirement "${reqName}" is not available. ` +
          `Available queries: ${Object.keys(ALLOWED_NAMED_QUERIES).sort().join(", ")}.`,
      );
    }
    const args = raw["args"];
    if (args !== undefined && !isPlainObject(args)) {
      fail(`\`source.args\` for requirement "${reqName}" must be an object.`);
    }
    return { kind: "query", query, ...(args ? { args } : {}) };
  }

  if (kind === "ast") {
    const model = asString(raw["model"]).trim();
    if (!(ALLOWED_AST_MODELS as readonly string[]).includes(model)) {
      fail(
        `Model "${model || "(missing)"}" for requirement "${reqName}" is not queryable. ` +
          `Allowed models: ${[...ALLOWED_AST_MODELS].sort().join(", ")}.`,
      );
    }

    const operation = asString(raw["operation"]).trim() || "findMany";
    if (!(ALLOWED_AST_OPERATIONS as readonly string[]).includes(operation)) {
      fail(
        `\`source.operation\` for requirement "${reqName}" must be one of: ` +
          `${ALLOWED_AST_OPERATIONS.join(", ")}.`,
      );
    }

    const where = raw["where"];
    if (where !== undefined) {
      if (!isPlainObject(where)) {
        fail(`\`source.where\` for requirement "${reqName}" must be an object.`);
      }
      if (objectDepth(where) > MAX_AST_WHERE_DEPTH) {
        fail(
          `\`source.where\` for requirement "${reqName}" nests deeper than ` +
            `${MAX_AST_WHERE_DEPTH} levels.`,
        );
      }
    }

    const orderBy = raw["orderBy"];
    if (orderBy !== undefined && !isPlainObject(orderBy) && !Array.isArray(orderBy)) {
      fail(`\`source.orderBy\` for requirement "${reqName}" must be an object or array.`);
    }

    const take = raw["take"];
    if (take !== undefined) {
      if (typeof take !== "number" || !Number.isInteger(take) || take < 1 || take > MAX_AST_TAKE) {
        fail(
          `\`source.take\` for requirement "${reqName}" must be a whole number between 1 ` +
            `and ${MAX_AST_TAKE}.`,
        );
      }
    }

    return {
      kind: "ast",
      model,
      operation: operation as "findMany" | "count",
      ...(where ? { where: where as Record<string, unknown> } : {}),
      ...(orderBy ? { orderBy: orderBy as ArtifactAstOrderBy } : {}),
      ...(take !== undefined ? { take } : {}),
    };
  }

  fail(
    `\`source.kind\` for requirement "${reqName}" must be "query" (a named backend query) ` +
      `or "ast" (a declarative model query).`,
  );
}

function parseDataRequirements(raw: unknown): ReactArtifactDataRequirement[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_DATA_REQUIREMENTS) {
    fail(`Too many dataRequirements: ${raw.length}. The limit is ${MAX_DATA_REQUIREMENTS}.`);
  }

  const requirements: ReactArtifactDataRequirement[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const source = isPlainObject(entry) ? entry["source"] : undefined;
    const name = asString(isPlainObject(entry) ? entry["name"] : undefined).trim();

    // Nameless legacy entries were dropped silently; keep doing that so old
    // payloads still validate, but never drop one that declares a source.
    if (!name) {
      if (source === undefined || source === null) continue;
      fail("Every dataRequirement with a `source` needs a `name`.");
    }

    if (!REQUIREMENT_NAME_RE.test(name)) {
      fail(
        `dataRequirement name "${name}" must be a valid identifier — letters, digits and ` +
          "underscores, not starting with a digit — because the app passes it to useXyneData().",
      );
    }
    if (seen.has(name)) fail(`Duplicate dataRequirement name "${name}".`);
    seen.add(name);

    const description = stripControlChars(
      asString(isPlainObject(entry) ? entry["description"] : undefined).trim(),
    );

    const parsedSource = parseDataSource(source, name);

    requirements.push({
      name,
      ...(description ? { description } : {}),
      ...(parsedSource ? { source: parsedSource } : {}),
    });
  }

  return requirements;
}

/**
 * Agents the app names as its preferred ones. Validated for shape only — whether
 * a slug exists, and whether the person opening the app may use it, is decided
 * per-viewer at dispatch time and cannot be decided here.
 */
function parseAgents(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail("`agents` must be an array of agent slugs.");
  if (raw.length > MAX_DECLARED_AGENTS) {
    fail(`Too many agents: ${raw.length}. The limit is ${MAX_DECLARED_AGENTS}.`);
  }

  const agents: string[] = [];
  for (const entry of raw) {
    const slug = asString(entry).trim();
    if (!slug) fail("Every entry in `agents` must be a non-empty agent slug.");
    if (!AGENT_SLUG_RE.test(slug)) {
      fail(
        `"${slug}" is not a valid agent slug — lowercase letters, digits and ` +
          "hyphens only, not starting with a hyphen.",
      );
    }
    if (agents.includes(slug)) fail(`Duplicate agent "${slug}".`);
    agents.push(slug);
  }
  return agents;
}

export interface BuiltReactArtifact {
  payload: ReactArtifactPayload;
  manifest: ReactArtifactManifest;
  summary: string;
}

/**
 * Validate raw tool params into the artifact payload + manifest. Exported so the
 * validation rules can be unit-tested without going through `execute`.
 * Throws {@link ValidationError} with a message the model can act on.
 */
export function buildReactArtifact(params: Record<string, unknown>): BuiltReactArtifact {
  const title = stripControlChars(asString(params["title"]).trim()).slice(0, MAX_TITLE_CHARS);
  if (!title) fail("`title` is required.");

  const files = parseFiles(params["files"]);
  const dependencies = parseDependencies(params["dependencies"]);
  const dataRequirements = parseDataRequirements(params["dataRequirements"]);

  const entry = asString(params["entry"]).trim();
  if (!entry) fail("`entry` is required (e.g. \"/App.tsx\").");
  if (!files.some((f) => f.path === entry)) {
    fail(`\`entry\` "${entry}" is not among the provided files: ${files.map((f) => f.path).join(", ")}.`);
  }

  const summary =
    stripControlChars(asString(params["summary"]).trim()).slice(0, MAX_SUMMARY_CHARS) ||
    `Generated "${title}" with ${files.length} file(s).`;

  const writes = params["writes"] === true;
  const agents = parseAgents(params["agents"]);
  const invokesAgents = params["invokesAgents"] === true || agents.length > 0;

  const payload: ReactArtifactPayload = {
    version: ARTIFACT_VERSION,
    title,
    entry,
    template: "react-ts",
    files,
    dependencies,
    dataRequirements,
    ...(writes ? { writes: true } : {}),
    ...(invokesAgents ? { invokesAgents: true } : {}),
    ...(agents.length ? { agents } : {}),
  };

  const manifest: ReactArtifactManifest = {
    version: ARTIFACT_VERSION,
    title,
    entry,
    fileCount: files.length,
    files: files.map((f) => f.path),
    dependencies: Object.keys(dependencies),
    dataRequirements,
    ...(writes ? { writes: true } : {}),
    ...(invokesAgents ? { invokesAgents: true } : {}),
    ...(agents.length ? { agents } : {}),
  };

  return { payload, manifest, summary };
}

/** Serialize a built artifact into the marker string the claw runtime parses. */
export function formatReactArtifactResult(built: BuiltReactArtifact): string {
  const data = Buffer.from(JSON.stringify(built.payload), "utf8").toString("base64");
  return (
    `[ATTACHMENT:${ARTIFACT_FILENAME}:${ARTIFACT_MIME}]\n${data}\n` +
    `${built.summary}\n` +
    `${MANIFEST_START} ${JSON.stringify(built.manifest)} ${MANIFEST_END}`
  );
}

export const createReactArtifactTool: ToolDefinition = {
  slug: "create-app",
  name: "Create app",
  // NOT "builtin": builtin-source tools are routed through pi's own built-in
  // allowlist (read/write/grep/find/ls) and never reach an agent's selectable
  // custom-tool palette — a tool declared builtin is silently absent from the
  // model's tool list no matter what the agent config selects.
  source: "custom:react-artifact",
  description:
    "Build a small, self-contained React app that the user can view and interact with, instead of " +
    "describing a UI in prose. Use it when the answer is better shown than told — a dashboard, a chart, " +
    "a comparison table, an interactive explainer. Write TypeScript React (.tsx) and default-export a " +
    "component from the `entry` file.\n\n" +
    "ONE APP PER CONVERSATION — this thread has a single app. Your FIRST call creates it; " +
    "every later call REPLACES its contents as a new version of that same app. So when asked " +
    "to change or fix something, re-send the whole project with the change applied — do not " +
    "announce a new app, do not rename it unless asked, and do not drop features you built " +
    "earlier just because the latest message did not mention them. Users can roll back to any " +
    "earlier version, so a mistake is recoverable — but a silent regression is not obvious.\n\n" +
    "DESIGN SYSTEM — the project is preloaded with Tailwind v4 and the shadcn/ui base set. Do NOT " +
    "write these yourself and do NOT list them in `dependencies`; they are injected for you:\n" +
    `  • shadcn/ui components at /components/ui/<name>: ${SHADCN_UI_COMPONENTS.join(", ")}\n` +
    "  • the `cn()` class helper at /lib/utils\n" +
    "Import them with relative paths, e.g. `import { Card, CardHeader, CardTitle, CardContent } from " +
    "'./components/ui/card'`. Style with Tailwind utility classes and the shadcn design tokens " +
    "(bg-background, text-foreground, bg-card, text-muted-foreground, border-border, bg-primary, " +
    "bg-destructive, rounded-lg…). ALWAYS use these components for atomic UI — buttons, cards, badges, " +
    "tables, tabs, inputs, dialogs — rather than hand-rolled <div>s, and never use inline `style` " +
    "objects for layout or color. Use recharts for charts and lucide-react for icons.\n\n" +
    "DATA — there is no network access inside the preview, so fetch/XHR always fails. Two ways to get " +
    "data in:\n" +
    "  (a) STATIC — inline it in the source as literals. Fine for explainers and fixed examples. Prefer " +
    "aggregates over raw rows: a large dataset can exceed your output limit and truncate this call.\n" +
    "  (b) LIVE (preferred for workspace data) — declare `dataRequirements`, then read them with the " +
    "preloaded hook:\n" +
    "        import { useXyneData } from './lib/xyne-data';\n" +
    "        const { status, data, error, refresh } = useXyneData('openTickets');\n" +
    "      The app is re-fetched every time someone opens it, so it is never stale, and it is fetched " +
    "AS THE VIEWER — so a colleague sees only rows their own permissions allow. Never inline data you " +
    "can declare instead; declaring costs a fraction of the tokens.\n" +
    "      You MUST render all three states: `loading` (a skeleton), `error` (a short message), and " +
    "`ready` with an EMPTY result — an empty list is normal, not a bug, because a viewer may be " +
    "permitted to see nothing. Dates arrive as epoch-millisecond NUMBERS: use `new Date(row.createdAt)`.\n" +
    `      Named sources — source: { "kind": "query", "query": …, "args": … }:\n` +
    Object.entries(ALLOWED_NAMED_QUERIES)
      .map(
        ([name, meta]) =>
          `        • ${name} ${meta.argsHint}${meta.note ? ` — ${meta.note}` : ""}` +
          (meta.fieldsHint ? `\n            fields: ${meta.fieldsHint}` : ""),
      )
      .join("\n") +
    "\n      Rows come back with EXACTLY these fields — do not invent others, and do not " +
    "assume a field exists because it would be convenient.\n" +
    "NAMES — ids are opaque, so NEVER render one and never join a `user` source to get a " +
    "name. Use the preloaded lookup, which is already resolved for you:\n" +
    "        import { useXyneDirectory } from './lib/xyne-data';\n" +
    "        const { displayName, channelName } = useXyneDirectory();\n" +
    "        displayName(message.senderId)   // \"Megha Trivedi\"\n" +
    "        channelName(row.channelId)      // \"#product\", or a DM\'s participants\n" +
    "      It costs no request and needs no dataRequirement. It also gets two things right " +
    "that you cannot infer from a row: a user\'s name is `displayName || name || email` and " +
    "`displayName` is usually EMPTY, and a DM channel\'s `name` column is not a name at all — " +
    "it holds the participant ids, so rendering `channel.name` for a DM prints raw ids. " +
    "Group DMs come back collapsed (\"Alice, Bob + 3 others\") and your own DM reads \"You\".\n" +
    "\n" +
    `      Or a direct query — source: { "kind": "ast", "model": …, "where": …, "orderBy": …, "take": … } ` +
    `over: ${[...ALLOWED_AST_MODELS].sort().join(", ")} (findMany or count, take <= ${MAX_AST_TAKE}). ` +
    `\`orderBy\` must be an ARRAY of single-key objects — [{"createdAt":"desc"}], NOT {"createdAt":"desc"}. ` +
    "`where` may traverse relations, e.g. { conversation: { channel: { scopeType: \"DM\" } } }.\n\n" +
    "WRITES — an app can also CHANGE data, using the same preloaded module:\n" +
    "        import { useXyneMutate } from './lib/xyne-data';\n" +
    "        const { mutate, status, error } = useXyneMutate();\n" +
    "        await mutate('ticket.update', { id, statusV2: 'COMPLETED' });\n" +
    "      Mutation names are `group.action` — e.g. ticket.update, ticket.create, " +
    "channel.joinChannel, canvas.update. The change runs AS THE PERSON USING THE APP, " +
    "under their own permissions, so it can only do what they could already do and is " +
    "refused otherwise (surface `error` when it is).\n" +
    "      Changes are IMMEDIATE and CANNOT BE UNDONE. Only ever call mutate() from a real " +
    "user action such as a click — NEVER during render, and NEVER in an effect on mount. " +
    "Set `writes: true` when the app calls it, so the user is told it can change things. " +
    "Reads you declared refresh automatically after a successful write.\n\n" +
    "AGENTS — an app can also hand work to a full AI agent, for anything that needs " +
    "judgement rather than a query: summarising, drafting, triaging, explaining, answering " +
    "a question about what the app is showing.\n" +
    "        import { useXyneAgent } from './lib/xyne-data';\n" +
    "        const { run, cancel, status, output, invocations, error } = useXyneAgent({ key: 'triage' });\n" +
    "        await run(`Group these ${tickets.length} tickets by theme: ${summary}`);\n" +
    "      The agent runs AS THE PERSON USING THE APP, using an agent they already have " +
    "access to, so it can only see and do what they could themselves.\n" +
    "      PUT THE DATA IN THE PROMPT. You already loaded it via dataRequirements, so build a " +
    "compact digest and include it — the agent then answers in ONE turn, in seconds. Asking the " +
    "agent to go and find the data itself (\"look up my tickets\", \"find my DMs\") makes it " +
    "re-discover with tools: minutes instead of seconds, for rows the app is already holding. " +
    "Trim the digest to what the question needs — recent items, short fields, no ids the model " +
    "will not use.\n" +
    "      A run takes MINUTES, not seconds. Design for that or the app will look broken:\n" +
    "        • render every `status` — idle, starting, running, completed, failed, cancelled;\n" +
    "        • show progress while running. `output` streams in as it is written, and " +
    "`invocations` lists the tools the agent is using (toolName, args, result), so show one " +
    "or both rather than a bare spinner;\n" +
    "        • offer cancel() on anything long.\n" +
    "      The run CONTINUES IF THE APP IS CLOSED and is restored when the user comes back — " +
    "so on mount, just render whatever `status` and `output` you are given; do NOT start a " +
    "run to repopulate them.\n" +
    "      `key` names a conversation: repeat run() calls on the same key CONTINUE that " +
    "thread, so the agent remembers earlier turns and the user can ask follow-ups. Use " +
    "different keys for unrelated tasks. Only ONE run per key at a time — a second call " +
    "while one is running is refused, so disable the button on `starting`/`running`.\n" +
    "      Only ever call run() from a real user action such as a click — NEVER during " +
    "render, and NEVER in an effect on mount: it is slow and it costs real money. " +
    "Set `invokesAgents: true` when the app calls it. Optionally name preferred agents in " +
    "`agents` — a hint only; a viewer without access to them sees the app say so.\n\n" +
    "Any npm package can be listed in `dependencies` ({name: version}, \"latest\" if the version " +
    "does not matter) — it is installed into the preview. Prefer ones already loaded (recharts for " +
    "charts, lucide-react for icons, date-fns, clsx) since they cost nothing, and prefer packages that " +
    "work in a browser with no build step: anything needing node built-ins, native modules or its own " +
    `compiler will fail to bundle. Limits: ${MAX_FILES} files, ` +
    `${MAX_FILE_BYTES / 1024}KB per file, ${MAX_TOTAL_BYTES / 1024}KB total.`,
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short, user-facing name for the app, e.g. \"Weekly ticket volume\".",
      },
      summary: {
        type: "string",
        description: "One or two sentences describing what was built. Shown to the user alongside the app.",
      },
      entry: {
        type: "string",
        description: "Path of the file with the default-exported root component, e.g. \"/App.tsx\".",
      },
      files: {
        type: "array",
        description: "Every file in the project. Paths are absolute within the project and start with \"/\".",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute project path, e.g. \"/App.tsx\" or \"/components/Chart.tsx\".",
            },
            content: { type: "string", description: "Full source of the file." },
          },
          required: ["path", "content"],
        },
      },
      dependencies: {
        type: "object",
        description:
          "npm packages the app imports, as {name: version}. Use \"latest\" when the version does not " +
          "matter. Any npm package may be used; it must work in the browser without a build step.",
      },
      writes: {
        type: "boolean",
        description:
          "Set to true when the app calls useXyneMutate() to change data. Shows the user a " +
          "badge that the app can modify their workspace.",
      },
      invokesAgents: {
        type: "boolean",
        description:
          "Set to true when the app calls useXyneAgent() to run an AI agent. Shows the user a " +
          "badge that the app can start agent runs.",
      },
      agents: {
        type: "array",
        description:
          "Optional agent slugs this app prefers, most-preferred first. A narrowing hint only — " +
          `the app always runs as the viewer, using agents THEY can access. Max ${MAX_DECLARED_AGENTS}. ` +
          "Omit unless the app is built around a specific agent.",
        items: { type: "string" },
      },
      dataRequirements: {
        type: "array",
        description:
          "Live data the app reads, resolved fresh on every open and scoped to the viewer's own " +
          `permissions. Read each one with useXyneData('<name>'). Max ${MAX_DATA_REQUIREMENTS}.`,
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Identifier the app passes to useXyneData(). Letters, digits and underscores only.",
            },
            description: {
              type: "string",
              description: "Optional. What this data is and how the app uses it.",
            },
            source: {
              type: "object",
              description:
                "Where the data comes from. Either a named backend query " +
                '({"kind":"query","query":"ticketsQueryV2","args":{...}}) or a direct model query ' +
                '({"kind":"ast","model":"ticket","where":{...},"take":100}). ' +
                "See the tool description for the available queries and models.",
              properties: {
                kind: { type: "string", enum: ["query", "ast"] },
                query: { type: "string", description: "Named query (kind=query)." },
                args: { type: "object", description: "Arguments for the named query (kind=query)." },
                model: { type: "string", description: "Model to read (kind=ast)." },
                operation: { type: "string", enum: ["findMany", "count"] },
                where: { type: "object", description: "Filter (kind=ast)." },
                orderBy: { type: "object", description: "Sort (kind=ast)." },
                take: { type: "number", description: `Row cap, max ${MAX_AST_TAKE} (kind=ast).` },
              },
              required: ["kind"],
            },
          },
          required: ["name"],
        },
      },
    },
    required: ["title", "entry", "files"],
  },
  execute: async (
    params: Record<string, unknown>,
    _context?: ToolExecutionContext,
  ): Promise<string> => {
    try {
      return formatReactArtifactResult(buildReactArtifact(params));
    } catch (err) {
      if (err instanceof ValidationError) {
        return `Error: ${err.message} Fix the input and call create-app again.`;
      }
      const message = err instanceof Error ? err.message : String(err);
      return `Error: failed to build the React artifact: ${message}`;
    }
  },
};
