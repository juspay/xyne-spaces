import type { HttpMcpAdapter } from "../types.js";

/**
 * Atlassian Rovo hosted MCP (Jira, Confluence, …) — Streamable HTTP at
 * https://mcp.atlassian.com/v1/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client); handled by
 * routes/atlassian-remote-oauth.ts, which stores { clientId, accessToken,
 * refreshToken, expires }. Atlassian only admits approved MCP clients /
 * allowlisted domains — a site admin may need to allowlist our redirect URI.
 *
 * OAuth discovery: https://mcp.atlassian.com/.well-known/oauth-authorization-server
 *   authorization_endpoint:  https://mcp.atlassian.com/v1/authorize
 *   token_endpoint:          https://mcp.atlassian.com/v1/token
 *   registration_endpoint:   https://mcp.atlassian.com/v1/register
 *   token_endpoint_auth:     none | client_secret_basic | client_secret_post
 *   PKCE:                    S256
 *
 * Tools: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/
 * Most tools take a `cloudId` from getAccessibleAtlassianResources.
 */
export const atlassianRemoteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "atlassian-remote",
  credentialFields: [],
  healthCheck: { name: "atlassianUserInfo", params: {} },
  writeTools: [
    // Common — generic proxies that can run write / destructive actions.
    "executeWrite",
    "executeDestructive",
    // Jira
    "createJiraIssue",
    "editJiraIssue",
    "transitionJiraIssue",
    "addOrEditJiraIssueComment",
    "addOrEditJiraIssueWorklog",
    "createJiraIssueLink",
    "manageJiraProjectVersion",
    "manageJiraProjectVersionRelatedWork",
    "manageJiraSprint",
    "createJiraBoard",
    "watchJiraIssue",
    "uploadAttachmentToJiraIssue",
    "editJiraEntityProperty",
    "createJiraIssueRemoteIssueLink",
    "convertJiraIssueHierarchy",
    "deleteJiraIssue",
    "deleteJiraComment",
    "deleteJiraIssueAttachment",
    "createJiraProject",
    "updateJiraProject",
    "updateJiraScreen",
    // Confluence
    "createConfluenceContent",
    "updateConfluenceContent",
    "createConfluenceSpace",
    "setConfluenceSpaceInstructions",
    "copyConfluenceContent",
    "moveConfluenceContent",
    "archiveConfluenceContent",
    "unarchiveConfluenceContent",
    "restoreConfluenceContentVersion",
    "convertConfluenceContentMode",
    "setConfluenceContentStatus",
    "createConfluenceComment",
    "updateConfluenceComment",
    "updateConfluenceCommentResolution",
    "createConfluenceAttachment",
    "addLabelsToConfluenceContent",
    "addConfluenceReaction",
    "addConfluenceContentPermissions",
    "removeConfluenceContentPermissions",
    "replaceConfluenceContentPermissions",
    "setConfluenceContentRestrictionState",
    "enableConfluencePublicLink",
    "disableConfluencePublicLink",
    "completeConfluenceTask",
    "reopenConfluenceTask",
    "starConfluenceContent",
    "unstarConfluenceContent",
    "starConfluenceSpace",
    "unstarConfluenceSpace",
    "watchConfluenceContent",
    "unwatchConfluenceContent",
    "watchConfluenceSpace",
    "unwatchConfluenceSpace",
    "watchConfluenceLabel",
    "unwatchConfluenceLabel",
    "createConfluenceInfographicForPage",
    "editConfluenceInfographicForPage",
    "createConfluenceMauiApp",
    "editConfluenceMauiApp",
    // Jira Service Management
    "updateJsmOpsAlert",
    // Bitbucket
    "createBitbucketRepoPullRequest",
    "updateBitbucketRepoPullRequest",
    "mergeBitbucketRepoPullRequest",
    "approveBitbucketRepoPullRequest",
    "requestChangesOnBitbucketRepoPullRequest",
    "addBitbucketRepoPullRequestComment",
    "resolveBitbucketRepoPullRequestComment",
    "reopenBitbucketRepoPullRequestComment",
    "createBitbucketRepoPullRequestTask",
    "setBitbucketRepoPullRequestTaskState",
    "createBitbucketRepoBranch",
    "createBitbucketRepoCommit",
    "runBitbucketRepoPipeline",
    // Platform: Teamwork Graph, Loom, Goals, Projects, Teams, Focus, Talent, Capacity
    "addTeamworkGraphContext",
    "createLoomVideoUpload",
    "publishLoomVideo",
    "updateLoomVideoTitle",
    "updateLoomVideoPermissions",
    "shareLoomVideo",
    "createLoomVideoComment",
    "createLoomVideoReaction",
    "createLoomFolder",
    "moveLoomVideoToFolder",
    "recoverLoomVideo",
    "createGoal",
    "createGoalUpdate",
    "addConnectionsToGoals",
    "createProject",
    "createProjectUpdate",
    "addConnectionsToProjects",
    "createTeam",
    "updateTeam",
    "createFocusArea",
    "updateFocusArea",
    "createFocusAreaStatusUpdate",
    "linkToFocusArea",
    "createTalentSkill",
    "updateTalentWorkerSkillMappings",
    "updateTalentPositionFocusAreaMappings",
    "updateCapacityPlanAllocation",
    "createCapacityPlanNonProjectWork",
    "updateCapacityPlanNonProjectWork",
  ],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Atlassian credentials missing accessToken");
    }
    return {
      url: "https://mcp.atlassian.com/v1/mcp",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  },
};
