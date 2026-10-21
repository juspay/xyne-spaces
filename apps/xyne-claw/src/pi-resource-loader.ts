/**
 * The one way claw builds a pi resource loader.
 *
 * pi's DefaultResourceLoader discovers code and prompt files relative to its
 * `cwd` and `agentDir`: `.pi/extensions/*.ts` (executed in this process),
 * `.pi/skills`, `.pi/prompts`, `.pi/SYSTEM.md` (replaces the system prompt),
 * `.pi/APPEND_SYSTEM.md`, `AGENTS.md`/`CLAUDE.md` up every parent directory,
 * and `.pi/settings.json`, whose `packages` list is npm-installed on reload.
 * For a parent run `cwd` is the agent's own writable workspace, so a prompt
 * injection that gets the agent to write one of those files would run code or
 * rewrite the prompt on its next turn. This loader takes only what claw passes
 * explicitly: in-code extension factories, listed skill directories and the
 * system prompt claw composed.
 */
import { DefaultResourceLoader, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

/**
 * The skills shipped in this package (`apps/xyne-claw/skills`). They used to
 * load by accident: XYNE_CLAW_AGENT_DIR defaults to "" so pi's agentDir was the
 * process cwd, whose `skills/` is this directory. The hardened loader stops
 * that discovery, so parent sessions list it explicitly.
 */
export const BUNDLED_SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

export interface HardenedResourceLoaderOptions {
  cwd: string;
  agentDir: string;
  extensionFactories: ExtensionFactory[];
  additionalSkillPaths?: string[];
  /** The composed persona prompt. Absent = pi's default prompt, never a file. */
  systemPrompt?: string | undefined;
}

export function createHardenedResourceLoader(options: HardenedResourceLoaderOptions): DefaultResourceLoader {
  const additionalSkillPaths = options.additionalSkillPaths ?? [];
  return new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    // Never read <cwd>/.pi/settings.json or <agentDir>/settings.json, whose
    // `packages` entries pi would npm/git-install during reload().
    settingsManager: SettingsManager.inMemory({}),
    extensionFactories: options.extensionFactories,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    ...(additionalSkillPaths.length > 0 ? { additionalSkillPaths } : {}),
    // With `systemPrompt` set, pi never looks for SYSTEM.md. Without it, pi
    // would use a discovered file as the whole prompt; drop that so the
    // session falls back to pi's built-in prompt instead.
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : { systemPromptOverride: () => undefined }),
    appendSystemPrompt: [],
  });
}
