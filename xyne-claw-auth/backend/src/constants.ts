export const UNREGISTERED_USER_TEMPLATE = `Hi! You are currently not enrolled in the system.

To get started:
1. Go to [XyneClaw Dashboard](https://spaces.xyne.juspay.net/claw) and log in using your **Xyne Spaces** account
2. Click on **Connect with Spaces** to add Xyne Spaces as your MCP

Once connected, I'll start working for you!

You can also configure additional MCPs like **Kibana**, **Grafana**, and **Bitbucket** for even more capabilities, and use specialized agents like **Program Manager** and **Xyne Doctor**.`;

/**
 * LLM Provider info shown to users.
 *
 * Default: shared LiteLLM proxy (configured by the workspace admin).
 * Override: each user can bring their own LLM key per agent via the
 * "Provider" button on the XyneClaw Dashboard — currently supports
 * GitHub Copilot login (device code OAuth, uses your Copilot subscription).
 *
 * To configure your own provider:
 * 1. Go to https://spaces.xyne.juspay.net/claw
 * 2. Find the agent you want to configure
 * 3. Click "Provider" → "Login with GitHub Copilot"
 * 4. Authorize in your browser and select your preferred model
 */
export const DEFAULT_PROVIDER = "litellm";
export const SUPPORTED_PROVIDERS = ["litellm", "copilot"] as const;
export type Provider = typeof SUPPORTED_PROVIDERS[number];
