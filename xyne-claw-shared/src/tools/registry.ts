/**
 * Central tool registry. Both xyne-claw-auth (for DB seeding/schema) and
 * xyne-claw (for execution) import from here.
 */

import type { ToolDefinition } from "./types.js";
import * as pgm from "./pgm/index.js";
import * as schedule from "./schedule/index.js";
import * as askQuestion from "./ask-question/index.js";

/** All custom tools, keyed by slug */
const CUSTOM_TOOLS: Record<string, ToolDefinition> = {};

function register(tool: ToolDefinition): void {
  CUSTOM_TOOLS[tool.slug] = tool;
}

// Register pgm tools
register(pgm.pgmListPrograms);
register(pgm.pgmReadProgram);
register(pgm.pgmReadTask);
register(pgm.pgmReadRun);
register(pgm.pgmListTasks);
register(pgm.pgmListRuns);
register(pgm.pgmCreateProgram);
register(pgm.pgmWriteTask);
register(pgm.pgmWriteRun);
register(pgm.pgmEditFile);
register(pgm.pgmCommit);
register(pgm.pgmPush);
register(pgm.pgmPull);
register(pgm.pgmRender);

// Register schedule + ask-question tools
register(schedule.scheduleTask);
register(askQuestion.askUserQuestion);

/** Get all registered custom tools */
export function getAllCustomTools(): ToolDefinition[] {
  return Object.values(CUSTOM_TOOLS);
}

/** Get a custom tool by slug */
export function getCustomTool(slug: string): ToolDefinition | undefined {
  return CUSTOM_TOOLS[slug];
}

/** Get all custom tools matching a source prefix (e.g., "custom:pgm") */
export function getToolsBySource(source: string): ToolDefinition[] {
  return Object.values(CUSTOM_TOOLS).filter((t) => t.source === source);
}
