/**
 * Signs the bot account in to Google with SSO and reports the result, without
 * joining a meeting. Use it after setting SSO up:
 *
 *   pnpm --filter meet-bot sso:check
 */
import { openBrowser } from "./browser.js";
import { loadConfig } from "./config.js";
import { MeetError } from "./meetPage.js";
import { installSsoResponder, signInWithSso } from "./sso.js";

const config = loadConfig();
if (!config.sso) {
  console.error("SSO isn't configured: set SSO_EMAIL in apps/meet-bot/.env and run `pnpm --filter meet-bot sso:setup`.");
  process.exit(1);
}

const context = await openBrowser(config);
let ok = false;
try {
  const page = await context.newPage();
  const lastSsoError = await installSsoResponder(page, config.sso);
  await signInWithSso(page, config.sso, "https://meet.google.com/", lastSsoError);
  ok = true;
  console.log(`\nSigned in to Google as ${config.sso.email}. The bot is ready to join meetings.`);
} catch (error) {
  const message = error instanceof MeetError || error instanceof Error ? error.message : String(error);
  console.error(`\nSSO sign-in failed: ${message}`);
} finally {
  await context.close().catch(() => undefined);
}
process.exit(ok ? 0 : 1);
