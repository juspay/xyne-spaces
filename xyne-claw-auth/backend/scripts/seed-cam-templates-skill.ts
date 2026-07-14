/**
 * Seed the `cam-templates` skill from a local FOLDER.
 *
 * Drop any files (PDFs, markdowns, images, anything) into the folder. The
 * script walks the tree recursively, encodes each file appropriately
 * (binary → base64, text → utf8), and uploads the whole bundle as the
 * skill's SkillFile set. Re-running replaces the bundle atomically.
 *
 * Layout under the folder is preserved as `relativePath`. For example:
 *
 *   ~/cam-templates/
 *     ├── template.pdf
 *     ├── notes/
 *     │   └── benchmarks.md
 *     └── examples/
 *         └── filled-sample.pdf
 *
 * Lands as 3 SkillFile rows with relativePaths
 *   "template.pdf"
 *   "notes/benchmarks.md"
 *   "examples/filled-sample.pdf"
 *
 * The script also binds the skill to an agent (default
 * `credit-appraisal-agent`).
 *
 * Usage:
 *   cd xyne-claw-auth/backend
 *   npx tsx --env-file=.env scripts/seed-cam-templates-skill.ts \
 *       /absolute/path/to/cam-templates
 *
 *   # Override the target agent slug:
 *   AGENT_SLUG=credit-appraisal-agent \
 *     npx tsx --env-file=.env scripts/seed-cam-templates-skill.ts /path/to/folder
 *
 *   # Override the skill slug:
 *   SKILL_SLUG=my-skill \
 *     npx tsx --env-file=.env scripts/seed-cam-templates-skill.ts /path/to/folder
 *
 * Hard caps (claw-auth side):
 *   - per-file size cap: 1 MB
 *   - total bundle cap:  5 MB
 *   - SKILL.md is reserved (owned by Skill.content); the script auto-skips it
 *     if present in the folder.
 */
import { readFile, stat, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { prisma } from "../src/db.js";
import { skillRepository } from "../src/repositories/skillRepository.js";

const SKILL_SLUG = process.env["SKILL_SLUG"] ?? "cam-templates";
const SKILL_NAME = process.env["SKILL_NAME"] ?? "CAM templates";
const SKILL_CONTENT = `# ${SKILL_NAME}

Template files for the credit-appraisal-agent. The PDF at
\`template.pdf\` is the bank's CAM AcroForm — call \`inspect-pdf-form\` on
it first to discover the exact field names, then call \`fill-pdf-form\`
with a values JSON keyed by those names.
`;
const MAX_FILE_BYTES = 1_000_000;
const MAX_BUNDLE_BYTES = 5_000_000;

const TEXT_EXTS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".xml", ".csv", ".log",
  ".html", ".htm", ".svg",
  ".js", ".ts", ".py", ".sh", ".rb", ".go", ".rs",
]);
const TEXT_MIME = (ext: string): string | undefined => {
  const m: Record<string, string> = {
    ".md": "text/markdown", ".txt": "text/plain",
    ".json": "application/json", ".yaml": "application/yaml", ".yml": "application/yaml",
    ".xml": "application/xml", ".csv": "text/csv",
    ".html": "text/html", ".htm": "text/html",
  };
  return m[ext];
};
const BINARY_MIME = (ext: string, defaultMime = "application/octet-stream"): string => {
  const m: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
  };
  return m[ext] ?? defaultMime;
};

interface BundledFile {
  relativePath: string;
  content: string;
  contentType: string;
  sizeBytes: number;
  encoding: "utf8" | "base64";
}

/** Recursively walk `rootDir` collecting regular files (sorted, deterministic). */
async function walkFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue; // skip dotfiles + dot-dirs
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        await visit(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  await visit(rootDir);
  return out;
}

async function main(): Promise<void> {
  const folderPath = process.argv[2];
  if (!folderPath) {
    console.error("Usage: tsx scripts/seed-cam-templates-skill.ts /absolute/path/to/folder");
    process.exit(1);
  }
  const absRoot = resolve(folderPath);
  const rootStat = await stat(absRoot).catch(() => null);
  if (!rootStat?.isDirectory()) {
    console.error(`Not a directory: ${absRoot}`);
    process.exit(1);
  }

  const agentSlug = process.env["AGENT_SLUG"] ?? "credit-appraisal-agent";

  console.log(`[seed-cam-templates] folder: ${absRoot}`);
  console.log(`[seed-cam-templates] skill:  ${SKILL_SLUG}`);
  console.log(`[seed-cam-templates] agent:  ${agentSlug}`);

  const orgIdFromEnv = process.env["ORG_ID"]?.trim() || undefined;
  const matchingAgents = await prisma.agent.findMany({
    where: { slug: agentSlug, ...(orgIdFromEnv ? { orgId: orgIdFromEnv } : {}) },
    select: { id: true, slug: true, orgId: true },
  });
  if (!orgIdFromEnv && matchingAgents.length > 1) {
    throw new Error(`AGENT_SLUG "${agentSlug}" exists in multiple orgs. Set ORG_ID and re-run.`);
  }
  const fallbackOrg = matchingAgents.length === 0
    ? await prisma.organization.findFirst({ where: { name: "Juspay" }, select: { id: true } })
    : null;
  const orgId = orgIdFromEnv ?? matchingAgents[0]?.orgId ?? fallbackOrg?.id;
  if (!orgId) {
    throw new Error("Cannot seed skill without an org. Set ORG_ID, or create the Juspay organization first.");
  }

  const files = await walkFiles(absRoot);
  if (files.length === 0) {
    console.error(`No files found under ${absRoot}.`);
    process.exit(1);
  }

  const bundle: BundledFile[] = [];
  let totalBytes = 0;
  for (const absPath of files) {
    const rel = relative(absRoot, absPath).split(sep).join("/");
    if (rel === "SKILL.md") {
      console.warn(`[seed-cam-templates] skipping reserved name SKILL.md (owned by Skill.content)`);
      continue;
    }
    const buf = await readFile(absPath);
    const sizeBytes = buf.byteLength;
    if (sizeBytes > MAX_FILE_BYTES) {
      console.error(
        `[seed-cam-templates] file too big: ${rel} = ${sizeBytes.toLocaleString()} bytes (cap ${MAX_FILE_BYTES.toLocaleString()})`,
      );
      process.exit(1);
    }
    if (totalBytes + sizeBytes > MAX_BUNDLE_BYTES) {
      console.error(
        `[seed-cam-templates] bundle would exceed cap of ${MAX_BUNDLE_BYTES.toLocaleString()} bytes at ${rel}`,
      );
      process.exit(1);
    }
    totalBytes += sizeBytes;

    const ext = extname(rel).toLowerCase();
    const isText = TEXT_EXTS.has(ext);
    if (isText) {
      bundle.push({
        relativePath: rel,
        content: buf.toString("utf8"),
        contentType: TEXT_MIME(ext) ?? "text/plain",
        sizeBytes,
        encoding: "utf8",
      });
    } else {
      bundle.push({
        relativePath: rel,
        content: buf.toString("base64"),
        contentType: BINARY_MIME(ext),
        sizeBytes,
        encoding: "base64",
      });
    }
  }

  // 1. Upsert the Skill row (content remains the static SKILL_CONTENT).
  const skill = await skillRepository.upsertBySlug(
    SKILL_SLUG,
    orgId,
    {
      slug: SKILL_SLUG,
      name: SKILL_NAME,
      description: "AcroForm PDF templates the credit-appraisal-agent fills.",
      content: SKILL_CONTENT,
      org: { connect: { id: orgId } },
    },
    {
      name: SKILL_NAME,
      description: "AcroForm PDF templates the credit-appraisal-agent fills.",
      content: SKILL_CONTENT,
    },
  );
  console.log(`[seed-cam-templates] Skill upserted: ${skill.slug} (id=${skill.id})`);

  // 2. Replace the SkillFile bundle. The skillRepository.replaceFiles call
  //    deletes existing rows and inserts the new ones atomically — safe to
  //    re-run.
  await skillRepository.replaceFiles(
    skill.id,
    bundle.map((b) => ({
      relativePath: b.relativePath,
      content: b.content,
      contentType: b.contentType,
    })),
  );
  console.log(`[seed-cam-templates] Wrote ${bundle.length} SkillFile row(s) (${totalBytes.toLocaleString()} bytes total):`);
  for (const b of bundle) {
    console.log(
      `  - ${b.relativePath.padEnd(40)} ${b.sizeBytes.toString().padStart(10)} bytes  ${b.contentType.padEnd(50)} (${b.encoding})`,
    );
  }

  // 3. Bind the skill to the agent.
  const agent = matchingAgents[0] ?? null;
  if (!agent) {
    console.warn(
      `[seed-cam-templates] Agent slug "${agentSlug}" not found — skill is seeded but not attached. Attach via the admin UI, or set AGENT_SLUG to an existing slug and re-run.`,
    );
  } else {
    await prisma.agentSkill.upsert({
      where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
      create: { agentId: agent.id, skillId: skill.id },
      update: {},
    });
    console.log(`[seed-cam-templates] Attached skill to agent: ${agent.slug} (agentId=${agent.id})`);
  }

  console.log(`[seed-cam-templates] Done.`);
}

main()
  .catch((err) => {
    console.error("[seed-cam-templates] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
