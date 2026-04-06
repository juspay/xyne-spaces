import path from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { parse as yamlParse, stringify as yamlStringify, parseDocument } from "yaml";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function dataPath(): string {
  const p = process.env["XYNE_PGM_DATA_PATH"];
  if (!p) throw new Error("XYNE_PGM_DATA_PATH environment variable is not set");
  return p;
}

function getUserId(ctx?: ToolExecutionContext): string {
  const userId = ctx?.meta?.["userId"];
  if (!userId) throw new Error("PGM tools require userId in execution context");
  return userId;
}

function userDir(ctx?: ToolExecutionContext): string {
  return path.join(dataPath(), getUserId(ctx));
}

function programsDir(ctx?: ToolExecutionContext): string {
  return path.join(userDir(ctx), "programs");
}

function templatesDir(ctx?: ToolExecutionContext): string {
  return path.join(userDir(ctx), "templates");
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  return {
    frontmatter: (yamlParse(match[1]!) as Record<string, unknown>) ?? {},
    body: match[2]!,
  };
}

function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  return `---\n${yamlStringify(fm).trim()}\n---\n${body}`;
}

async function renderTemplate(ctx: ToolExecutionContext | undefined, name: string, vars: Record<string, string>): Promise<string> {
  const templatePath = path.join(templatesDir(ctx), name);
  let content = await readFile(templatePath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{ ${key} }}`, value);
  }
  return content;
}

function addChapterToQuarto(ctx: ToolExecutionContext | undefined, slug: string, filePath: string, partName: string): void {
  const quartoPath = path.join(programsDir(ctx), slug, "_quarto.yml");
  const raw = execSync(`cat "${quartoPath}"`, { encoding: "utf-8" });
  const doc = parseDocument(raw);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = doc.get("book") as any;
  if (!book) throw new Error("No 'book' key in _quarto.yml");

  const chapters = book.get("chapters");
  if (!chapters || !chapters.items) throw new Error("No 'chapters' array in _quarto.yml");

  for (const item of chapters.items) {
    if (item.get && item.get("part") === partName) {
      const partChapters = item.get("chapters");
      if (partChapters && partChapters.items) {
        partChapters.items.push(doc.createNode(filePath));
      }
      break;
    }
  }

  execSync(`cat > "${quartoPath}" << 'YAMLEOF'\n${doc.toString()}\nYAMLEOF`, {
    cwd: userDir(ctx),
  });
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function nextRunNumber(ctx: ToolExecutionContext | undefined, slug: string): Promise<number> {
  const runsDir = path.join(programsDir(ctx), slug, "runs");
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return 1;
  }
  let max = 0;
  for (const f of files) {
    const match = f.match(/^run-(\d+)\.qmd$/);
    if (match) {
      const n = parseInt(match[1]!, 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

function gitExec(ctx: ToolExecutionContext | undefined, cmd: string): string {
  return execSync(cmd, { cwd: userDir(ctx), encoding: "utf-8" }).trim();
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const pgmListPrograms: ToolDefinition = {
  slug: "pgm-list-programs",
  name: "List Programs",
  description: "List all programs (Quarto books) in the data repo, optionally filtered by status.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "paused", "completed", "archived"], description: "Filter by status" },
    },
  },
  async execute(args, ctx) {
    const dir = programsDir(ctx);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return "No programs directory found.";
    }

    const results: { name: string; slug: string; status: string }[] = [];
    for (const entry of entries.sort()) {
      const indexPath = path.join(dir, entry, "index.qmd");
      try {
        const content = await readFile(indexPath, "utf-8");
        const { frontmatter } = parseFrontmatter(content);
        const status = (frontmatter["status"] as string) ?? "unknown";
        if (args["status"] && status !== args["status"]) continue;
        results.push({
          name: (frontmatter["title"] as string) ?? entry,
          slug: entry,
          status,
        });
      } catch {
        // skip
      }
    }

    if (results.length === 0) return "No programs found.";
    return results.map((r) => `- **${r.name}** (\`${r.slug}\`) — ${r.status}`).join("\n");
  },
};

export const pgmReadProgram: ToolDefinition = {
  slug: "pgm-read-program",
  name: "Read Program",
  description: "Read the full content of a program's index.qmd file.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug (directory name)" },
    },
    required: ["program"],
  },
  async execute(args, ctx) {
    const filePath = path.join(programsDir(ctx), args["program"] as string, "index.qmd");
    return await readFile(filePath, "utf-8");
  },
};

export const pgmReadTask: ToolDefinition = {
  slug: "pgm-read-task",
  name: "Read Task",
  description: "Read the full content of a task .qmd file within a program.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
      task: { type: "string", description: "Task slug (filename without .qmd)" },
    },
    required: ["program", "task"],
  },
  async execute(args, ctx) {
    const filePath = path.join(programsDir(ctx), args["program"] as string, "tasks", `${args["task"] as string}.qmd`);
    return await readFile(filePath, "utf-8");
  },
};

export const pgmReadRun: ToolDefinition = {
  slug: "pgm-read-run",
  name: "Read Run",
  description: "Read the full content of a run .qmd file within a program.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
      run: { type: "string", description: "Run identifier (number or 'run-NNN')" },
    },
    required: ["program", "run"],
  },
  async execute(args, ctx) {
    const runStr = args["run"] as string;
    const runId = runStr.startsWith("run-") ? runStr : `run-${runStr.padStart(3, "0")}`;
    const filePath = path.join(programsDir(ctx), args["program"] as string, "runs", `${runId}.qmd`);
    return await readFile(filePath, "utf-8");
  },
};

export const pgmListTasks: ToolDefinition = {
  slug: "pgm-list-tasks",
  name: "List Tasks",
  description: "List all tasks within a program, showing slug, status, and owner.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
    },
    required: ["program"],
  },
  async execute(args, ctx) {
    const tasksDir = path.join(programsDir(ctx), args["program"] as string, "tasks");
    let files: string[];
    try {
      files = await readdir(tasksDir);
    } catch {
      return "No tasks directory found for this program.";
    }

    const results: { slug: string; status: string; owner: string }[] = [];
    for (const file of files.sort()) {
      if (!file.endsWith(".qmd")) continue;
      const content = await readFile(path.join(tasksDir, file), "utf-8");
      const { frontmatter } = parseFrontmatter(content);
      results.push({
        slug: file.replace(/\.qmd$/, ""),
        status: (frontmatter["status"] as string) ?? "unknown",
        owner: (frontmatter["owner"] as string) ?? "unassigned",
      });
    }

    if (results.length === 0) return "No tasks found.";
    return results.map((r) => `- \`${r.slug}\` — ${r.status} (${r.owner})`).join("\n");
  },
};

export const pgmListRuns: ToolDefinition = {
  slug: "pgm-list-runs",
  name: "List Runs",
  description: "List all runs for a program by returning the runs index file content.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
    },
    required: ["program"],
  },
  async execute(args, ctx) {
    const indexPath = path.join(programsDir(ctx), args["program"] as string, "runs", "_index.qmd");
    return await readFile(indexPath, "utf-8");
  },
};

export const pgmCreateProgram: ToolDefinition = {
  slug: "pgm-create-program",
  name: "Create Program",
  description: "Create a new program (Quarto book) from templates. Scaffolds directory structure.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Program name" },
      description: { type: "string", description: "Program description" },
      channel: { type: "string", description: "Associated channel" },
    },
    required: ["name"],
  },
  async execute(args, ctx) {
    const name = args["name"] as string;
    const slug = toSlug(name);
    const programDir = path.join(programsDir(ctx), slug);
    const vars: Record<string, string> = {
      NAME: name,
      SLUG: slug,
      DESCRIPTION: (args["description"] as string) ?? "",
      CHANNEL: (args["channel"] as string) ?? "",
      DATE: new Date().toISOString().split("T")[0]!,
    };

    await mkdir(path.join(programDir, "tasks"), { recursive: true });
    await mkdir(path.join(programDir, "runs"), { recursive: true });

    await writeFile(path.join(programDir, "_quarto.yml"), await renderTemplate(ctx, "_quarto.yml", vars));
    await writeFile(path.join(programDir, "index.qmd"), await renderTemplate(ctx, "index.qmd", vars));
    await writeFile(path.join(programDir, "runs", "_index.qmd"), await renderTemplate(ctx, "runs/_index.qmd", vars));

    return `Created program **${name}** at \`programs/${slug}/\``;
  },
};

export const pgmWriteTask: ToolDefinition = {
  slug: "pgm-write-task",
  name: "Write Task",
  description: "Create or update a task within a program.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
      name: { type: "string", description: "Task name" },
      description: { type: "string", description: "Task description" },
      owner: { type: "string", description: "Task owner" },
      deadline: { type: "string", description: "Task deadline (YYYY-MM-DD)" },
    },
    required: ["program", "name"],
  },
  async execute(args, ctx) {
    const program = args["program"] as string;
    const name = args["name"] as string;
    const taskSlug = toSlug(name);
    const tasksDir = path.join(programsDir(ctx), program, "tasks");
    await mkdir(tasksDir, { recursive: true });

    const vars: Record<string, string> = {
      NAME: name,
      SLUG: taskSlug,
      DESCRIPTION: (args["description"] as string) ?? "",
      OWNER: (args["owner"] as string) ?? "",
      DEADLINE: (args["deadline"] as string) ?? "",
      DATE: new Date().toISOString().split("T")[0]!,
    };

    const content = await renderTemplate(ctx, "task.qmd", vars);
    await writeFile(path.join(tasksDir, `${taskSlug}.qmd`), content);

    addChapterToQuarto(ctx, program, `tasks/${taskSlug}.qmd`, "Tasks");

    return `Created task **${name}** at \`tasks/${taskSlug}.qmd\``;
  },
};

export const pgmWriteRun: ToolDefinition = {
  slug: "pgm-write-run",
  name: "Write Run",
  description: "Create a new run entry for a program.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
      trigger: { type: "string", enum: ["scheduled", "manual", "event"], description: "What triggered this run" },
      content: { type: "string", description: "Markdown body for the run report" },
    },
    required: ["program", "trigger", "content"],
  },
  async execute(args, ctx) {
    const program = args["program"] as string;
    const runNum = await nextRunNumber(ctx, program);
    const runId = `run-${String(runNum).padStart(3, "0")}`;
    const runsDir = path.join(programsDir(ctx), program, "runs");
    await mkdir(runsDir, { recursive: true });

    const date = new Date().toISOString().split("T")[0]!;
    const fm: Record<string, unknown> = { title: runId, date, trigger: args["trigger"] };
    const content = serializeFrontmatter(fm, (args["content"] as string) + "\n");
    await writeFile(path.join(runsDir, `${runId}.qmd`), content);

    addChapterToQuarto(ctx, program, `runs/${runId}.qmd`, "Agent Runs");

    const indexPath = path.join(runsDir, "_index.qmd");
    try {
      const existing = await readFile(indexPath, "utf-8");
      const row = `| ${runId} | ${date} | ${args["trigger"] as string} | — |\n`;
      await writeFile(indexPath, existing.trimEnd() + "\n" + row);
    } catch {
      // skip
    }

    return `Created run **${runId}** at \`runs/${runId}.qmd\``;
  },
};

export const pgmEditFile: ToolDefinition = {
  slug: "pgm-edit-file",
  name: "Edit File",
  description: "Overwrite a .qmd file within a program with new content.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
      file: { type: "string", description: "Relative file path (e.g. 'index.qmd', 'tasks/my-task.qmd')" },
      content: { type: "string", description: "Full new file content" },
    },
    required: ["program", "file", "content"],
  },
  async execute(args, ctx) {
    const file = args["file"] as string;
    if (file.includes("..")) throw new Error("Path traversal not allowed");
    if (!file.endsWith(".qmd")) throw new Error("Only .qmd files can be edited");

    const filePath = path.join(programsDir(ctx), args["program"] as string, file);
    await writeFile(filePath, args["content"] as string);
    return `Updated \`${file}\` in program \`${args["program"] as string}\``;
  },
};

export const pgmCommit: ToolDefinition = {
  slug: "pgm-commit",
  name: "Git Commit",
  description: "Stage all changes and commit in the pgm data repo.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message" },
    },
    required: ["message"],
  },
  async execute(args, ctx) {
    gitExec(ctx, "git add -A");
    return gitExec(ctx, `git commit --author="PM Agent <pm-agent@xyne.app>" -m ${JSON.stringify(args["message"] as string)}`);
  },
};

export const pgmPush: ToolDefinition = {
  slug: "pgm-push",
  name: "Git Push",
  description: "Push the pgm data repo to its remote.",
  source: "custom:pgm",
  inputSchema: { type: "object", properties: {} },
  async execute(_args, ctx) {
    return gitExec(ctx, "git push") || "Pushed successfully.";
  },
};

export const pgmPull: ToolDefinition = {
  slug: "pgm-pull",
  name: "Git Pull",
  description: "Pull latest changes in the pgm data repo (with rebase).",
  source: "custom:pgm",
  inputSchema: { type: "object", properties: {} },
  async execute(_args, ctx) {
    return gitExec(ctx, "git pull --rebase") || "Already up to date.";
  },
};

// ─── HTML Merge Helper ──────────────────────────────────────────────────────

async function mergeBookHtml(bookDir: string, htmlFiles: string[]): Promise<string> {
  const indexPath = path.join(bookDir, "index.html");
  let base = await readFile(indexPath, "utf-8");

  const subPages = htmlFiles.filter(f => f !== "index.html").sort();
  const extraSections: string[] = [];

  for (const file of subPages) {
    const html = await readFile(path.join(bookDir, file), "utf-8");
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    if (!mainMatch) continue;

    const sectionId = file.replace(/\.html$/, "");
    extraSections.push(`<section id="${sectionId}" class="merged-page">\n<hr style="margin:3em 0">\n${mainMatch[1]}\n</section>`);
  }

  // Also check subdirectories (tasks/, runs/)
  for (const subdir of ["tasks", "runs"]) {
    const subdirPath = path.join(bookDir, subdir);
    let subFiles: string[];
    try {
      subFiles = (await readdir(subdirPath)).filter(f => f.endsWith(".html"));
    } catch {
      continue;
    }
    for (const file of subFiles) {
      const html = await readFile(path.join(subdirPath, file), "utf-8");
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
      if (!mainMatch) continue;

      const sectionId = `${subdir}/${file.replace(/\.html$/, "")}`;
      extraSections.push(`<section id="${sectionId}" class="merged-page">\n<hr style="margin:3em 0">\n${mainMatch[1]}\n</section>`);
    }
  }

  if (extraSections.length > 0) {
    base = base.replace(/<\/main>/, `\n${extraSections.join("\n\n")}\n</main>`);

    // Rewrite links: "./tasks/foo.html" → "#tasks/foo", "./runs/bar.html" → "#runs/bar"
    base = base.replace(/href="\.\/([^"#]+?)\.html"/g, (_match, name) => `href="#${name as string}"`);
    // Also handle without ./ prefix
    base = base.replace(/href="((?:tasks|runs)\/[^"#]+?)\.html"/g, (_match, name) => `href="#${name as string}"`);
  }

  return base;
}

// ─── Render Tool ────────────────────────────────────────────────────────────

export const pgmRender: ToolDefinition = {
  slug: "pgm-render",
  name: "Render Program",
  description: "Render a program's Quarto book to a single self-contained HTML file with all pages merged. Automatically attached to the response.",
  source: "custom:pgm",
  inputSchema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Program slug" },
    },
    required: ["program"],
  },
  async execute(args, ctx) {
    const program = args["program"] as string;
    const programDir = path.join(programsDir(ctx), program);

    try {
      await readFile(path.join(programDir, "_quarto.yml"), "utf-8");
    } catch {
      return `Program "${program}" not found or missing _quarto.yml`;
    }

    try {
      execSync("quarto render . --to html --embed-resources --standalone", { cwd: programDir, encoding: "utf-8", timeout: 120_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Quarto render failed: ${msg.slice(0, 500)}`;
    }

    const bookDir = path.join(programDir, "_book");
    let htmlFiles: string[];
    try {
      htmlFiles = (await readdir(bookDir)).filter(f => f.endsWith(".html"));
    } catch {
      return "Render succeeded but no _book/ output directory found.";
    }

    if (htmlFiles.length === 0) return "Render succeeded but no HTML files found in _book/.";

    // Merge all pages into a single HTML file with working anchor links
    const merged = await mergeBookHtml(bookDir, htmlFiles);

    // Note: ctx not available in this tool signature — use a workaround
    // The tool returns the HTML as a special marker that custom-tools.ts can detect
    return `[ATTACHMENT:${program}.html:text/html]\n${Buffer.from(merged).toString("base64")}`;
  },
};
