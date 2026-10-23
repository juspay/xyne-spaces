import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { createBotServer } from "./server.js";
import { MeetSession } from "./session.js";

const config = loadConfig();
if (!config.apiKey) {
  // Not an error: `pnpm dev` can start this for developers who don't use it.
  log.warn("not_configured", {
    hint: "Copy apps/meet-bot/.env.example to apps/meet-bot/.env and set MEET_BOT_API_KEY (see apps/meet-bot/README.md)",
  });
  process.exit(0);
}
if (!config.sso && !config.allowGuest) {
  log.warn("sso_not_configured", {
    hint: "Set SSO_EMAIL and run `pnpm --filter meet-bot sso:setup` (see apps/meet-bot/README.md), or set ALLOW_GUEST_JOIN=true to join as a guest",
  });
}

const server = createBotServer(config, (request, backend) => new MeetSession(request, config, backend));
server.listen(config.port, () => {
  log.info("meet_bot_listening", { port: config.port, sso: config.sso?.email ?? null, botName: config.botName });
});

// Leave meetings and report them ended, so the backend doesn't keep waiting on them.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info("shutting_down", { signal });
    server.close();
    void server.stopSessions(8_000).finally(() => process.exit(0));
  });
}
