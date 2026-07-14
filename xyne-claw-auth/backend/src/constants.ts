export const UNREGISTERED_USER_TEMPLATE = `Hi! You are currently not enrolled in the system.

To get started:
1. Go to [XyneClaw Dashboard](https://spaces.xyne.juspay.net/claw) and log in using your **Xyne Spaces** account
2. Click on **Connect with Spaces** to add Xyne Spaces as your MCP

Once connected, I'll start working for you!

You can also configure additional MCPs like **Kibana**, **Grafana**, and **Bitbucket** for even more capabilities, and use specialized agents like **Program Manager** and **Xyne Doctor**.`;
export const SUPPORTED_PROVIDERS = ["litellm", "copilot"] as const;
export type Provider = typeof SUPPORTED_PROVIDERS[number];
