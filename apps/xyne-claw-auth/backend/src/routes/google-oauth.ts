import { createClassicOAuthProvider } from "../lib/classic-oauth-provider.js";

const { router, callbackRouter, provider } = createClassicOAuthProvider({
  type: "google",
  label: "Google",
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scope: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.responses.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
  ].join(" "),
  extraAuthParams: { access_type: "offline", prompt: "consent" },
  rotatesRefreshToken: false,
  server: {
    name: "Google",
    url: "",
    description: "Google OAuth integration (Gmail, Calendar, Contacts, Tasks, Drive)",
  },
});

export const googleOAuthRouter = router;
export const googleCallbackRouter = callbackRouter;
export const googleOAuthProvider = provider;
