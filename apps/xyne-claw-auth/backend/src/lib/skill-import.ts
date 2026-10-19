import { parse as parseYaml } from "yaml";
import { badRequest, HttpError } from "./http.js";
import { safeFetch, SafeFetchError } from "./safe-fetch.js";
import { createLogger } from "../logger.js";

const log = createLogger("skill-import");

// Imports skills from public GitHub repos using the discovery rules of the
// `skills` npm package (vercel-labs/skills). Nothing from the repo is executed.

const MAX_SKILL_FILE_BYTES = 1_000_000;
const MAX_SKILL_BUNDLE_BYTES = 5_000_000;
const MAX_SKILL_FILES = 100;
const MAX_DISCOVERED_SKILLS = 200;
const FETCH_CONCURRENCY = 5;
const GITHUB_HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "xyne-spaces" };
const MAX_DEPTH = 5;
const MAX_LINK_SEGMENTS = 20;
const MAX_LINK_LENGTH = 2048;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"]);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface SkillSourceRef {
  owner: string;
  repo: string;
  /** Raw `<branch>/<path>` segments after `tree/`; the branch must be the repo's default branch. */
  treeSegments: string[];
  /** From a skills.sh link's third segment: the one skill it points at. */
  skill?: string;
}

export interface DiscoveredSkill {
  /** Folder of the skill inside the repo, "" for a root SKILL.md. */
  path: string;
  name: string;
  description: string;
  content: string;
}

/** One commit's file list, from the tree API: repo-relative path → size in bytes. */
export interface RepoTree {
  owner: string;
  repo: string;
  sha: string;
  blobs: Map<string, number>;
}

export interface ImportFile {
  relativePath: string;
  content: string;
  contentType: string;
}

export function isValidSkillSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Accepts `owner/repo`, `https://github.com/owner/repo[.git]` and `.../tree/<branch>/<path>`. */
export function parseSkillSourceUrl(input: string): SkillSourceRef {
  if (input.length > MAX_LINK_LENGTH) throw badRequest("Link is too long.");
  // A loop, not /\/+$/: that regex is polynomial on user input (CodeQL js/polynomial-redos).
  let bare = input.trim();
  let end = bare.length;
  while (end > 0 && bare[end - 1] === "/") end--;
  bare = bare.slice(0, end);
  const trimmed = /^(www\.)?(github\.com|skills\.sh)\//i.test(bare) ? `https://${bare}` : bare;
  let skill: string | undefined;
  const path = /^https?:\/\//i.test(trimmed)
    ? (() => {
        const url = new URL(trimmed);
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        const segments = url.pathname.split("/").filter(Boolean);
        // skills.sh/<owner>/<repo>[/<skill>] lists github.com/<owner>/<repo>.
        if (host === "skills.sh") {
          skill = segments[2] && decodeURIComponent(segments[2]);
          return segments.slice(0, 2).join("/");
        }
        if (host !== "github.com") throw badRequest("Paste a github.com repo or a skills.sh link.");
        return segments.join("/");
      })()
    : trimmed;
  const segments = path.split("/").filter(Boolean);
  if (segments.length > MAX_LINK_SEGMENTS) throw badRequest("Link is too long.");
  const [owner, rawRepo, kind, ...rest] = segments;
  const repo = rawRepo?.replace(/\.git$/i, "");
  const part = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !part.test(owner) || !part.test(repo)) {
    throw badRequest("Paste owner/repo, a github.com repo link or a skills.sh link.");
  }
  if (kind !== undefined && kind !== "tree") {
    throw badRequest("Link must point at a repo or a tree/<branch>/<path> folder");
  }
  if (kind === "tree" && rest.length === 0) throw badRequest("tree link is missing a branch");
  if (rest.some((s) => s === "..")) throw badRequest("Invalid path in link");
  return {
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
    treeSegments: rest.map(decodeURIComponent),
    ...(skill ? { skill } : {}),
  };
}

async function commitSha(owner: string, repo: string, ref: string): Promise<string | null> {
  const res = await safeFetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${ref.split("/").map(encodeURIComponent).join("/")}`,
    { headers: { Accept: "application/vnd.github.sha", "User-Agent": "xyne-spaces" } },
  );
  if (res.status === 404 || res.status === 422) return null;
  if (res.status === 403 || res.status === 429) {
    throw new HttpError(503, "GitHub rate limit reached, try again in a few minutes");
  }
  if (!res.ok) throw new HttpError(502, `GitHub returned ${res.status}`);
  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new HttpError(502, "GitHub did not return a commit SHA");
  return sha;
}

/** Resolves the link to a commit and the subpath inside the repo, in at most 2 GitHub calls. */
export async function resolveSkillSource(ref: SkillSourceRef): Promise<{ sha: string; subpath: string }> {
  const notFound = new HttpError(404, `${ref.owner}/${ref.repo} not found or not public`);
  if (ref.treeSegments.length === 0) {
    const sha = await commitSha(ref.owner, ref.repo, "HEAD");
    if (!sha) throw notFound;
    return { sha, subpath: "" };
  }
  const res = await safeFetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, { headers: GITHUB_HEADERS });
  if (res.status === 404) throw notFound;
  const limited = rateLimited(res.status);
  if (limited) throw limited;
  if (!res.ok) throw new HttpError(502, `GitHub returned ${res.status}`);
  const branch = ((await res.json()) as { default_branch?: string }).default_branch;
  if (!branch) throw new HttpError(502, "GitHub did not return a default branch");
  const branchSegments = branch.split("/");
  if (!branchSegments.every((segment, i) => ref.treeSegments[i] === segment)) {
    throw badRequest(`Only the repo's default branch (${branch}) can be imported.`);
  }
  const sha = await commitSha(ref.owner, ref.repo, branch);
  if (!sha) throw notFound;
  return { sha, subpath: ref.treeSegments.slice(branchSegments.length).join("/") };
}

function rateLimited(status: number): HttpError | null {
  return status === 403 || status === 429
    ? new HttpError(503, "GitHub rate limit reached, try again in a few minutes")
    : null;
}

/** Every file path at the commit, without downloading the repo. */
export async function listRepoTree(owner: string, repo: string, sha: string): Promise<RepoTree> {
  const res = await safeFetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, {
    headers: GITHUB_HEADERS,
  });
  const limited = rateLimited(res.status);
  if (limited) throw limited;
  if (!res.ok) throw new HttpError(502, `GitHub returned ${res.status}`);
  const body = (await res.json()) as {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };
  if (body.truncated) {
    throw new HttpError(
      413,
      `Repo is too big to list. Paste a link to the skill folder (github.com/${owner}/${repo}/tree/<branch>/<path>).`,
    );
  }
  const blobs = new Map<string, number>();
  for (const entry of body.tree ?? []) {
    if (entry.type === "blob" && typeof entry.path === "string") blobs.set(entry.path, entry.size ?? 0);
  }
  return { owner, repo, sha, blobs };
}

/** One file's bytes at the commit, or null past the 1 MB file limit. */
async function fetchRaw(tree: RepoTree, path: string): Promise<Buffer | null> {
  let res: Response;
  try {
    res = await safeFetch(
      `https://raw.githubusercontent.com/${tree.owner}/${tree.repo}/${tree.sha}/${path.split("/").map(encodeURIComponent).join("/")}`,
      { headers: { "User-Agent": "xyne-spaces" } },
      { maxResponseBytes: MAX_SKILL_FILE_BYTES },
    );
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === "response-too-large") return null;
    throw err;
  }
  const limited = rateLimited(res.status);
  if (limited) throw limited;
  if (!res.ok) throw new HttpError(502, `Could not read ${path} from ${tree.owner}/${tree.repo} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** `fn` over `items`, at most `limit` at a time, results in input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function parseSkillMd(content: string): { name: string; description: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  let data: unknown;
  try {
    data = parseYaml(match[1]!);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { name, description, metadata } = data as Record<string, unknown>;
  if (typeof name !== "string" || typeof description !== "string" || !name.trim() || !description.trim()) return null;
  if ((metadata as Record<string, unknown> | undefined)?.["internal"] === true) return null;
  return { name: name.trim(), description: description.trim() };
}

function isPriorityDir(dir: string): boolean {
  const segs = dir.split("/");
  return segs.length === 1 || segs[0] === "skills" || (segs[0]!.startsWith(".") && segs[1] === "skills");
}

/** Port of `discoverSkills` from the `skills` package. */
export async function discoverSkills(tree: RepoTree, subpath: string): Promise<DiscoveredSkill[]> {
  const prefix = subpath ? `${subpath}/` : "";
  const dirs = [...tree.blobs.keys()]
    .filter((p) => p.startsWith(prefix) && (p === `${prefix}SKILL.md` || p.endsWith("/SKILL.md")))
    .map((p) => p.slice(prefix.length, -"SKILL.md".length).replace(/\/$/, ""))
    .filter((dir) => {
      const segs = dir ? dir.split("/") : [];
      return segs.length <= MAX_DEPTH && !segs.some((s) => SKIP_DIRS.has(s));
    })
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  let picked: string[];
  if (dirs.includes("")) {
    picked = [""];
  } else {
    // A skill folder never holds another skill.
    const outer = dirs.filter((d) => !dirs.some((o) => o !== d && d.startsWith(`${o}/`)));
    const priority = outer.filter(isPriorityDir);
    picked = priority.length > 0 ? priority : outer;
  }

  // Every picked SKILL.md is one fetch, so refuse a huge repo before the first one.
  if (picked.length > MAX_DISCOVERED_SKILLS) {
    throw new HttpError(
      413,
      `Repo has over ${MAX_DISCOVERED_SKILLS} skills. Paste a link to one skill folder (github.com/${tree.owner}/${tree.repo}/tree/<branch>/<path>).`,
    );
  }
  // Only the picked SKILL.md files are fetched.
  const read = await mapLimit(picked, FETCH_CONCURRENCY, (dir) =>
    readSkill(tree, [subpath, dir].filter(Boolean).join("/")),
  );
  const skills: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  for (const skill of read) {
    if (!skill) continue;
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    skills.push(skill);
  }
  return skills;
}

/** The skill whose SKILL.md sits in `path`, or null when it is missing or invalid. */
export async function readSkill(tree: RepoTree, path: string): Promise<DiscoveredSkill | null> {
  const file = path ? `${path}/SKILL.md` : "SKILL.md";
  const size = tree.blobs.get(file);
  if (size === undefined || size > MAX_SKILL_FILE_BYTES) return null;
  const buf = await fetchRaw(tree, file);
  if (!buf) return null;
  const content = buf.toString("utf8");
  const meta = parseSkillMd(content);
  return meta ? { path, ...meta, content } : null;
}

/** A skill folder's sibling files, by repo-relative path, as the tree lists them. */
function skillFilePaths(tree: RepoTree, skillPath: string): string[] {
  const prefix = skillPath ? `${skillPath}/` : "";
  return [...tree.blobs.keys()].filter(
    (path) =>
      path.startsWith(prefix) &&
      path !== `${prefix}SKILL.md` &&
      !path.slice(prefix.length).split("/").some((s) => SKIP_DIRS.has(s)),
  );
}

/** The first limit the tree sizes already break, before anything is fetched. */
function treeLimitError(tree: RepoTree, skillPath: string, paths: string[]): string | undefined {
  if (paths.length > MAX_SKILL_FILES) return `Skill has over ${MAX_SKILL_FILES} files`;
  const prefix = skillPath ? `${skillPath}/` : "";
  let total = 0;
  for (const path of paths) {
    const size = tree.blobs.get(path) ?? 0;
    if (size > MAX_SKILL_FILE_BYTES) return `${path.slice(prefix.length)} is over the 1 MB file limit`;
    total += size;
    if (total > MAX_SKILL_BUNDLE_BYTES) return "Skill is over the 5 MB limit";
  }
  return undefined;
}

/** A skill's file count, size and broken limit from the tree alone, for the preview. Fetches nothing. */
export function skillFileStats(
  tree: RepoTree,
  skillPath: string,
): { fileCount: number; sizeBytes: number; error?: string } {
  const paths = skillFilePaths(tree, skillPath);
  const error = treeLimitError(tree, skillPath, paths);
  const sizeBytes = paths.reduce((total, path) => total + (tree.blobs.get(path) ?? 0), 0);
  return { fileCount: paths.length, sizeBytes, ...(error ? { error } : {}) };
}

/**
 * Sibling files of a skill folder, sized against the per-file, per-skill and file-count limits.
 * Returns the first limit broken as `error` instead of throwing, so the caller can grey the skill out.
 * Fetches only this folder's files, and only once the tree sizes fit.
 */
export async function readSkillFiles(
  tree: RepoTree,
  skillPath: string,
): Promise<{ files: ImportFile[]; sizeBytes: number; error?: string }> {
  const prefix = skillPath ? `${skillPath}/` : "";
  const paths = skillFilePaths(tree, skillPath);
  const treeError = treeLimitError(tree, skillPath, paths);
  if (treeError) return { files: [], sizeBytes: 0, error: treeError };
  const bufs = await mapLimit(paths, FETCH_CONCURRENCY, (path) => fetchRaw(tree, path));
  const files: ImportFile[] = [];
  let sizeBytes = 0;
  for (const [index, path] of paths.entries()) {
    const relativePath = path.slice(prefix.length);
    const buf = bufs[index];
    if (!buf) return { files, sizeBytes, error: `${relativePath} is over the 1 MB file limit` };
    const text = buf.toString("utf8");
    // Binary files are stored base64 with a non-text contentType, which claw decodes on materialize.
    const isText = !buf.includes(0) && Buffer.from(text, "utf8").equals(buf);
    const file: ImportFile = isText
      ? { relativePath, content: text, contentType: "text/plain" }
      : { relativePath, content: buf.toString("base64"), contentType: "application/octet-stream" };
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_SKILL_FILE_BYTES) return { files, sizeBytes, error: `${relativePath} is over the 1 MB file limit` };
    sizeBytes += bytes;
    if (sizeBytes > MAX_SKILL_BUNDLE_BYTES) return { files, sizeBytes, error: "Skill is over the 5 MB limit" };
    files.push(file);
  }
  return { files, sizeBytes };
}

/** `Skill.source` for an import. The commit goes last so "already imported" is a prefix match. */
export function skillSourceKey(owner: string, repo: string, path: string, sha?: string): string {
  return `github:${owner}/${repo}:${path}@${sha ?? ""}`;
}

/** Rewrites only the frontmatter `name:` line, used when the user renames a clashing slug. */
export function renameSkillContent(content: string, slug: string): string {
  return content.replace(/^(---\r?\n[\s\S]*?)^name:.*$/m, `$1name: ${slug}`);
}

export interface SkillSearchResult {
  source: string;
  skillId: string;
  name: string;
  installs: number;
}

/** skills.sh search. Throws 502 when skills.sh fails, so the dialog can tell that apart from no results. */
export async function searchSkillsSh(query: string): Promise<SkillSearchResult[]> {
  let body: { skills?: Array<Partial<SkillSearchResult>> };
  try {
    const res = await safeFetch(
      `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=20`,
      {},
      { timeoutMs: 5_000 },
    );
    if (!res.ok) throw new Error(`skills.sh returned ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    log.warn(`[skills/import/search] ${err instanceof Error ? err.message : String(err)}`);
    throw new HttpError(502, "Could not search skills.sh");
  }
  return (body.skills ?? [])
    .filter((s): s is SkillSearchResult => typeof s.source === "string" && typeof s.skillId === "string")
    .map(({ source, skillId, name, installs }) => ({
      source,
      skillId,
      name: name ?? skillId,
      installs: typeof installs === "number" ? installs : 0,
    }));
}

const TOP_SKILLS_LIMIT = 20;
const TOP_SKILLS_TTL_MS = 60 * 60 * 1000;
// One leaderboard entry as the homepage embeds it, with or without the RSC payload's escaping.
const TOP_ENTRY_RE =
  /\\?"source\\?":\\?"([^"\\]+)\\?",\\?"skillId\\?":\\?"([^"\\]+)\\?",\\?"name\\?":\\?"([^"\\]*)\\?",\\?"installs\\?":(\d+)/g;
let topSkillsCache: { at: number; data: SkillSearchResult[] } | null = null;

/** The skills.sh homepage leaderboard, deduped by source + skillId, first 20 in page order. */
export function parseSkillsShTop(html: string): SkillSearchResult[] {
  const seen = new Set<string>();
  const rows: SkillSearchResult[] = [];
  for (const [, source, skillId, name, installs] of html.matchAll(TOP_ENTRY_RE)) {
    const key = `${source}/${skillId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ source: source!, skillId: skillId!, name: name || skillId!, installs: Number(installs) });
    if (rows.length === TOP_SKILLS_LIMIT) break;
  }
  return rows;
}

/**
 * Top skills on skills.sh. It has no API for them, so they come from its homepage, cached an hour.
 * Never throws: a failed refresh keeps the last good list, or returns [] when there is none.
 */
export async function topSkillsSh(): Promise<SkillSearchResult[]> {
  if (topSkillsCache && Date.now() - topSkillsCache.at < TOP_SKILLS_TTL_MS) return topSkillsCache.data;
  try {
    const res = await safeFetch(
      "https://skills.sh/",
      // A non-browser agent gets a redirect page with no leaderboard in it.
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", Accept: "text/html" } },
      { maxResponseBytes: 3_000_000, timeoutMs: 10_000 },
    );
    if (!res.ok) throw new Error(`skills.sh returned ${res.status}`);
    const data = parseSkillsShTop(await res.text());
    if (data.length === 0) throw new Error("no leaderboard entries found on skills.sh");
    topSkillsCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    log.warn(`[skills/import/top] ${err instanceof Error ? err.message : String(err)}`);
    return topSkillsCache?.data ?? [];
  }
}
