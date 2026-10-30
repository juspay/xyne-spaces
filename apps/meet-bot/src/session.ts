import type { BrowserContext, Page } from "playwright";
import { openBrowser } from "./browser.js";
import type { Config } from "./config.js";
import { LivekitPublisher, decodePcm } from "./livekitPublisher.js";
import { SpeakerRouter, type Speaker } from "./speakerRouter.js";
import { log } from "./log.js";
import { installSsoResponder, signInWithSso } from "./sso.js";
import type { MeetingPlatform } from "./meetingUrl.js";
import { PLATFORM_FLOWS } from "./platforms.js";
import {
  MeetError,
  captureScript,
  readState,
  startCapture,
  waitUntilInCall,
  type EndReason,
  type MeetState,
} from "./meetPage.js";

export type SessionStatus = "joining" | "waiting_room" | "in_call" | "ended" | "failed";

export interface SessionRequest {
  sessionId: string;
  platform: MeetingPlatform;
  meetingUrl: string;
}

/** The default LiveKit participant: audio before anyone is seen speaking. */
const PLATFORM_PARTICIPANT: Record<MeetingPlatform, string> = {
  google_meet: "Google Meet",
  teams: "Microsoft Teams",
};

export interface StatusEvent {
  sessionId: string;
  status: SessionStatus;
  reason?: EndReason;
  message?: string;
}

export interface LivekitSession {
  livekitUrl: string;
  token: string;
}

/** What a session needs from the backend. */
export interface SessionBackend {
  reportStatus(event: StatusEvent): Promise<void>;
  /**
   * LiveKit credentials once the bot is in the meeting: the default "Google Meet"
   * participant without `speaker`, or one named after a speaker. null means "don't
   * stream" (pnpm try).
   */
  startLivekit(speaker?: Speaker): Promise<LivekitSession | null>;
}

const POLL_MS = 2_000;
/** Consecutive polls without the in-call UI before we treat the bot as out of the meeting. */
const OUT_OF_CALL_POLLS = 5;

/**
 * Decides, from one poll of the Meet UI, whether the bot should leave.
 * `tracker` carries what earlier polls saw.
 */
export function endReasonFor(
  state: MeetState,
  tracker: { outOfCallPolls: number; aloneSince: number | null; startedAt: number },
  now: number,
  limits: { aloneTimeoutMs: number; maxMeetingMs: number },
): EndReason | null {
  if (state.removed) return "removed";
  if (state.ended) return "meeting_ended";
  tracker.outOfCallPolls = state.inCall ? 0 : tracker.outOfCallPolls + 1;
  if (tracker.outOfCallPolls >= OUT_OF_CALL_POLLS) return "left_call";
  if (state.livekitDisconnected) return "livekit_disconnected";
  // Alone when Meet says so, or when only the bot's own participant tile is left
  // (0 tiles means the count can't be read, not that nobody is here).
  if (state.aloneMessage || state.participants === 1) {
    tracker.aloneSince ??= now;
    if (now - tracker.aloneSince >= limits.aloneTimeoutMs) return "alone";
  } else {
    tracker.aloneSince = null;
  }
  if (now - tracker.startedAt >= limits.maxMeetingMs) return "max_duration";
  return null;
}

export class MeetSession {
  status: SessionStatus = "joining";
  private cancelled = false;
  private publisher: LivekitPublisher | null = null;
  private router: SpeakerRouter | null = null;

  constructor(
    readonly request: SessionRequest,
    private readonly config: Config,
    private readonly backend: SessionBackend,
  ) {}

  cancel(): void {
    this.cancelled = true;
  }

  get isActive(): boolean {
    return this.status !== "ended" && this.status !== "failed";
  }

  async run(): Promise<void> {
    const { sessionId } = this.request;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let leave: () => Promise<void> = async () => undefined;
    try {
      await this.setStatus("joining");
      const flow = PLATFORM_FLOWS[this.request.platform];
      context = await openBrowser(this.config, { fakeMediaDevices: flow.fakeMediaDevices });
      await context.addInitScript({ content: captureScript(this.request.platform, this.config.botName) });
      page = await context.newPage();
      const activePage = page;
      leave = () => flow.leave(activePage);
      const sso = flow.googleSignIn ? this.config.sso : null;
      if (sso) {
        // Each meeting signs in afresh in its own browser: nothing to keep or expire.
        const lastSsoError = await installSsoResponder(page, sso);
        await signInWithSso(page, sso, this.request.meetingUrl, lastSsoError);
        if (this.cancelled) throw new MeetError("cancelled");
      }
      if (!page.url().startsWith(this.request.meetingUrl)) {
        await page.goto(this.request.meetingUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      }

      const joined = await flow.join(page, {
        botName: this.config.botName,
        allowGuest: this.config.allowGuest || !sso,
      });
      if (joined === "asked") {
        await this.setStatus("waiting_room");
        await waitUntilInCall(page, this.config.waitingRoomTimeoutMs, () => this.cancelled);
      }

      // The backend creates the LiveKit room only now, so a bot stuck in the lobby
      // never leaves an empty "live" call behind.
      const livekit = await this.backend.startLivekit();
      if (livekit) {
        const publisher = new LivekitPublisher(sessionId, PLATFORM_PARTICIPANT[this.request.platform]);
        this.publisher = publisher;
        await publisher.connect(async () => livekit);
        const router = new SpeakerRouter(sessionId, publisher, (speaker) => {
          const sink = new LivekitPublisher(sessionId, speaker.name);
          void sink
            .connect(async () => {
              const credentials = await this.backend.startLivekit(speaker);
              if (!credentials) throw new Error("no LiveKit session for speaker");
              return credentials;
            })
            .catch(() => undefined);
          return sink;
        });
        this.router = router;
        await startCapture(page, (base64Pcm, speaker) => router.push(decodePcm(base64Pcm), speaker));
      } else {
        log.warn("streaming_skipped", { sessionId, reason: "no LiveKit session" });
      }
      await this.setStatus("in_call");

      const reason = await this.watch(page);
      await leave();
      await this.setStatus("ended", reason);
    } catch (error) {
      const reason = error instanceof MeetError ? error.reason : "error";
      const message = error instanceof Error ? error.message : String(error);
      log.warn("session_failed", { sessionId, reason, message });
      await leave();
      // Cancelling is a normal end, not a failure.
      await this.setStatus(reason === "cancelled" ? "ended" : "failed", reason, message);
    } finally {
      await this.router?.close();
      await this.publisher?.close();
      await context?.close().catch(() => undefined);
    }
  }

  private async watch(page: Page): Promise<EndReason> {
    const tracker = { outOfCallPolls: 0, aloneSince: null as number | null, startedAt: Date.now() };
    let lastSeen = "";
    for (;;) {
      if (this.cancelled) return "cancelled";
      if (page.isClosed()) return "left_call";
      const pageState = await readState(page).catch(() => null);
      if (pageState) {
        const state = { ...pageState, livekitDisconnected: this.publisher?.disconnected ?? false };
        const seen = JSON.stringify({
          inCall: state.inCall,
          participants: state.participants,
          alone: state.aloneMessage,
          speaker: state.speaker,
        });
        if (seen !== lastSeen) {
          lastSeen = seen;
          log.info("meeting_state", { sessionId: this.request.sessionId, ...JSON.parse(seen) });
        }
        const reason = endReasonFor(state, tracker, Date.now(), this.config);
        if (reason) return reason;
      }
      await page.waitForTimeout(POLL_MS).catch(() => undefined);
    }
  }

  private async setStatus(status: SessionStatus, reason?: EndReason, message?: string): Promise<void> {
    this.status = status;
    log.info("session_status", { sessionId: this.request.sessionId, status, reason });
    await this.backend.reportStatus({
      sessionId: this.request.sessionId,
      status,
      ...(reason && { reason }),
      ...(message && { message }),
    }).catch((error: unknown) => log.warn("status_report_failed", { sessionId: this.request.sessionId, error: String(error) }));
  }
}
