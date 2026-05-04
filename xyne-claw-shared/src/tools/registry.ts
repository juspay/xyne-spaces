/**
 * Central tool registry. Both xyne-claw-auth (for DB seeding/schema) and
 * xyne-claw (for execution) import from here.
 */

import type { ToolDefinition } from "./types.js";
import * as pgm from "./pgm/index.js";
import * as google from "./google/index.js";
import * as microsoft from "./microsoft/index.js";
import * as schedule from "./schedule/index.js";
import * as askQuestion from "./ask-question/index.js";
import * as attachment from "./attachment/index.js";
import * as researchAgent from "./research-agent/index.js";
import * as sandbox from "./sandbox/index.js";
import * as sandboxPw from "./sandbox-pw/index.js";
import * as createPpt from "./create-ppt/index.js";

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
register(pgm.pgmPublish);

// Register schedule + ask-question tools
register(schedule.scheduleTask);
register(askQuestion.askUserQuestion);

// Register google tools
register(google.googleGmailSearch);
register(google.googleGmailRead);
register(google.googleGmailDraft);
register(google.googleGmailTrash);
register(google.googleGmailAttachment);
register(google.googleCalendarEvents);
register(google.googleCalendarCreate);
register(google.googleCalendarDelete);
register(google.googleCalendarList);
register(google.googleContactsSearch);
register(google.googleContactsList);
register(google.googleTasksLists);
register(google.googleTasksList);
register(google.googleTasksCreate);
register(google.googleTasksUpdate);
register(google.googleTasksDelete);
register(google.googleDriveRead);
register(google.googleDriveSearch);

// Register attachment tool
register(attachment.sendAttachmentTool);

// Register microsoft tools
register(microsoft.microsoftOutlookSearch);
register(microsoft.microsoftOutlookRead);
register(microsoft.microsoftOutlookDraft);
register(microsoft.microsoftOutlookTrash);
register(microsoft.microsoftCalendarEvents);
register(microsoft.microsoftCalendarCreate);
register(microsoft.microsoftCalendarDelete);
register(microsoft.microsoftCalendarList);
register(microsoft.microsoftContactsSearch);
register(microsoft.microsoftContactsList);
register(microsoft.microsoftTasksLists);
register(microsoft.microsoftTasksList);
register(microsoft.microsoftTasksCreate);
register(microsoft.microsoftTasksUpdate);
register(microsoft.microsoftTasksDelete);
register(microsoft.microsoftOneDriveSearch);
register(microsoft.microsoftOneDriveRead);
register(microsoft.microsoftTeamsList);
register(microsoft.microsoftTeamsChannels);
register(microsoft.microsoftTeamsMessages);
register(microsoft.microsoftTeamsSend);
register(microsoft.microsoftTeamsChats);
register(microsoft.microsoftTeamsChatMessages);
register(microsoft.microsoftTeamsChatSend);

// Register research-agent tools
register(researchAgent.queryCodebase);
register(researchAgent.reviewPullRequest);

// Register create-ppt tools
register(createPpt.createPptTool);
register(createPpt.editPptTool);

// Register sandbox tools
register(sandbox.sandboxCreate);
register(sandbox.sandboxRun);
register(sandbox.sandboxRunDetached);
register(sandbox.sandboxPollJob);
register(sandbox.sandboxWriteFile);
register(sandbox.sandboxReadFile);
register(sandbox.sandboxDestroy);
register(sandbox.sandboxRepoSetup);

// Register sandbox-pw tools (browser via @playwright/mcp through sandbox-router-test)
for (const t of sandboxPw.SANDBOX_PW_TOOLS) register(t);


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
