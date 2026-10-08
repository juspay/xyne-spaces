/**
 * publish-app — open one of the user's apps to their whole workspace.
 *
 * Publishes the app's current HEAD: the version the user is looking at and the
 * one the agent last built or restored to. The published pin then stays put
 * while later updates move head, exactly as the dashboard's Publish button
 * behaves; publishing again is how a newer build reaches everyone else.
 *
 * Owner only — enforced by claw-auth's publish route, which this calls as the
 * run's user. A write tool, so the runtime asks the user before it runs:
 * publishing makes something visible to every colleague in the workspace.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { REACT_ARTIFACT_CONFIG_SCHEMA } from "./tools.js";
import { parseAppId, publishAppHead } from "./appApi.js";

export const publishArtifactAppTool: ToolDefinition = {
  slug: "publish-app",
  name: "Publish app",
  source: "custom:react-artifact",
  configSchema: REACT_ARTIFACT_CONFIG_SCHEMA,
  isWriteTool: true,
  description:
    "Publish one of the user's apps so everyone in their workspace can open it. Publishes the " +
    "app's current version; later updates do NOT reach viewers until it is published again.\n\n" +
    "Only call this when the user asks to publish or share the app. Only the app's owner can " +
    "publish it.",
  inputSchema: {
    type: "object",
    properties: {
      appId: {
        type: "string",
        description:
          "Id of the app to publish — from a create-app result, or given with an app the user attached.",
      },
    },
    required: ["appId"],
  },
  execute: async (
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> => {
    const appId = parseAppId(params["appId"]);
    if (!appId) {
      return "Error: `appId` is required — the id from a create-app result, or of an app the user attached.";
    }

    const result = await publishAppHead(appId, context);
    if (!result.ok) return `Error: ${result.error}`;

    const { title, versionNumber } = result.value;
    return (
      `Published "${title}" (version ${versionNumber}) to the workspace. Everyone in it can now ` +
      "open the app. Later updates stay private until it is published again."
    );
  },
};
