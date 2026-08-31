import { createClassicOAuthProvider } from "../lib/classic-oauth-provider.js";

const tenant = (): string => process.env["MICROSOFT_TENANT_ID"] ?? "common";

const { router, callbackRouter, provider } = createClassicOAuthProvider({
  type: "microsoft",
  label: "Microsoft",
  clientIdEnv: "MICROSOFT_CLIENT_ID",
  clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  authUrl: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`,
  tokenUrl: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
  scope: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "Mail.Read",
    "Mail.ReadWrite",
    "Calendars.ReadWrite",
    "Contacts.Read",
    "People.Read",
    "Tasks.ReadWrite",
    "Files.Read.All",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "ChannelMessage.Read.All",
    "ChannelMessage.Send",
    "Chat.Read",
    "Chat.ReadWrite",
    "ChatMessage.Read",
    "ChatMessage.Send",
    "User.Read",
  ].join(" "),
  extraAuthParams: { response_mode: "query", prompt: "consent" },
  rotatesRefreshToken: true,
  server: {
    name: "Microsoft",
    url: "",
    description: "Microsoft OAuth integration (Outlook, Calendar, Contacts, To Do, OneDrive, Teams)",
  },
});

export const microsoftOAuthRouter = router;
export const microsoftCallbackRouter = callbackRouter;
export const microsoftOAuthProvider = provider;
