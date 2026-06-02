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
import * as addCitations from "./add-citations/index.js";
import * as attachment from "./attachment/index.js";
import * as researchAgent from "./research-agent/index.js";
import * as sandbox from "./sandbox/index.js";
import * as sandboxPw from "./sandbox-pw/index.js";
import * as createPpt from "./create-ppt/index.js";
import * as createReport from "./create-report/index.js";
import * as genius from "./genius/index.js";
import * as webSearch from "./web-search/index.js";
import * as deepResearch from "./deep-research/index.js";
import * as generateImage from "./generate-image/index.js";
import * as workload from "./workload-analyser/index.js";
import * as createPdf from "./create-pdf/index.js";
import * as fillPdfForm from "./fill-pdf-form/index.js";
import * as jenkins from "./jenkins/index.js";

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

// Register schedule + ask-question + add-citations tools
register(schedule.scheduleTask);
register(askQuestion.askUserQuestion);
register(addCitations.addCitationsTool);

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
register(google.googleDriveCreateFolder);
register(google.googleDriveUpload);
register(google.googleDriveShare);
register(google.googleSheetsCreate);
register(google.googleSheetsUpdate);
register(google.googleSheetsAppend);
register(google.googleDocsCreate);
register(google.googleDocsAppend);
register(google.googleDocsRead);
register(google.googleDocsEdit);
register(google.googleDocsFormat);
register(google.googleSlidesCreate);
register(google.googleSlidesAddSlide);
register(google.googleFormsCreate);
register(google.googleFormsAddQuestions);
register(google.googleFormsGet);

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

// Register create-html-report tool — renders a markdown report into a
// standalone HTML file and attaches it, leaving a short summary inline in
// chat. See xyne-claw-shared/src/tools/create-report/tools.ts.
register(createReport.createHtmlReportTool);

// Register create-pdf tools
// register(createPdf.createPdfTool);
// register(createPdf.editPdfTool);

// Register genius tools
register(genius.geniusAnalyticsTool);
register(genius.geniusInvestigationTool);

// Register web-search and deep-research tools
register(webSearch.webSearchTool);
register(deepResearch.deepResearchTool);

// Register generate-image tool
register(generateImage.generateImageTool);

// Register create-pdf tools (create + edit round-trip via doc JSON; readPdfTool
// removed — its tools.ts export was dropped in the cherry-pick, re-add when
// the implementation lands.)
register(createPdf.createPdfTool);
register(createPdf.editPdfTool);

// Register fill-pdf-form tools — work with AcroForm fillable PDFs the
// agent has access to (admin-uploaded as Skill files, OR user-attached in
// the @mention). inspect-pdf-form discovers field names; fill-pdf-form
// substitutes values + posts the filled PDF as an attachment.
register(fillPdfForm.inspectPdfForm);
register(fillPdfForm.fillPdfForm);

// Register jenkins tools
register(jenkins.jenkinsTriggerBuild);
register(jenkins.jenkinsGetBuildStatus);
register(jenkins.jenkinsListBuilds);
register(jenkins.jenkinsGetBuildLogs);

// Register sandbox tools
register(sandbox.sandboxCreate);
register(sandbox.sandboxRun);
register(sandbox.sandboxRunDetached);
register(sandbox.sandboxPollJob);
register(sandbox.sandboxWriteFile);
register(sandbox.sandboxReadFile);
register(sandbox.sandboxDeliverFiles);
register(sandbox.sandboxDestroy);
register(sandbox.sandboxRepoSetup);

// Register workload tools
register(workload.workloadInitRepo);
register(workload.workloadPull);
register(workload.workloadListReports);
register(workload.workloadReadReport);
register(workload.workloadWriteReport);
register(workload.workloadRenderReport);
register(workload.workloadCommit);
register(workload.workloadPush);
register(workload.workloadComputeCapacity);


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
