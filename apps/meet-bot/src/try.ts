/**
 * Runs one bot session from the terminal, without the backend:
 *
 *   pnpm --filter meet-bot try <meeting-link> [livekit-url livekit-token]
 *
 * Without LiveKit details it only joins the Meet and logs what it sees, which is
 * enough to check the SSO sign-in and the join flow. Ctrl+C leaves.
 */
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { parseMeetingUrl } from "./meetingUrl.js";
import { MeetSession } from "./session.js";

const [link, livekitUrl = "", livekitToken = ""] = process.argv.slice(2);
const meeting = link ? parseMeetingUrl(link) : null;
if (!meeting) {
  console.error("Usage: pnpm --filter meet-bot try <meeting-link> [livekit-url livekit-token]");
  process.exit(1);
}

const session = new MeetSession({ sessionId: `try-${meeting.code}`, platform: meeting.platform, meetingUrl: meeting.url }, loadConfig(), {
  reportStatus: async (event) => log.info("status", { ...event }),
  // A hand-made token can't name speakers, so everyone stays "Google Meet" here.
  startLivekit: async (speaker) => (!speaker && livekitUrl && livekitToken ? { livekitUrl, token: livekitToken } : null),
});
process.on("SIGINT", () => session.cancel());
await session.run();
