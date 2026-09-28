import { Router, type Request, type Response } from "express";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateS2SKey } from "../middleware/auth.js";
import { TASK_COMMANDS } from "../task-commands.js";
import { createLogger } from "../logger.js";

const log = createLogger("task-commands-internal");

const router = Router();

const XYNE_CLAW_PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));
const SKILL_CONTENT_BUDGET_BYTES = 400 * 1024;

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdownFiles(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(full);
  }
  return files.sort();
}

router.get("/internal/task-commands/:name", validateS2SKey, async (req: Request<{ name: string }>, res: Response) => {
  const name = req.params.name;
  if (!/^[a-z0-9-]{1,40}$/i.test(name)) {
    res.status(400).json({ success: false, error: "Invalid task command name" });
    return;
  }
  const command = TASK_COMMANDS.find((c) => c.command === `/${name.toLowerCase()}`);
  if (!command) {
    res.status(404).json({ success: false, error: "Unknown task command" });
    return;
  }

  const skills: Array<{ name: string; content: string }> = [];
  let used = 0;
  let skipped = 0;
  for (const skillPath of command.skillPaths ?? []) {
    const root = path.resolve(XYNE_CLAW_PACKAGE_DIR, skillPath);
    for (const file of await collectMarkdownFiles(root)) {
      const content = await readFile(file, "utf8").catch(() => null);
      if (content === null) continue;
      const size = Buffer.byteLength(content, "utf8");
      if (used + size > SKILL_CONTENT_BUDGET_BYTES) {
        skipped += 1;
        continue;
      }
      used += size;
      skills.push({ name: path.relative(XYNE_CLAW_PACKAGE_DIR, file), content });
    }
  }
  if (skipped > 0) {
    log.warn(`[task-commands] /${name}: ${skipped} skill file(s) skipped — ${SKILL_CONTENT_BUDGET_BYTES} byte cap reached`);
  }

  res.json({ name: command.command.slice(1), instruction: command.instruction, skills });
});

export { router as taskCommandsInternalRouter };
