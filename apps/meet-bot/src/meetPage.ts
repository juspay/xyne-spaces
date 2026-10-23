import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import type { Speaker } from "./speakerRouter.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const CAPTURE_SCRIPT = readFileSync(path.join(here, "inpage", "meet-capture.js"), "utf8");

/** What the Meet UI currently shows; produced by `state()` in inpage/meet-capture.js. */
export interface MeetState {
  inCall: boolean;
  nameInput: boolean;
  blocked: boolean;
  denied: boolean;
  notAdmitted: boolean;
  removed: boolean;
  ended: boolean;
  notFound: boolean;
  participants: number;
  /** Meet is showing its "You're the only one here" message. */
  aloneMessage: boolean;
  /** Who Meet currently shows as speaking, once capture has started. */
  speaker: string | null;
  remoteAudioTracks: number;
  /** Not from the page: set by the session from its LiveKit connection. */
  livekitDisconnected: boolean;
}

/** Why a session stopped; reported to the backend as-is. */
export type EndReason =
  | "sso_failed"
  | "not_signed_in"
  | "blocked"
  | "denied"
  | "not_admitted"
  | "waiting_room_timeout"
  | "meeting_not_found"
  | "join_button_not_found"
  | "removed"
  | "meeting_ended"
  | "left_call"
  | "alone"
  | "max_duration"
  | "livekit_disconnected"
  | "cancelled"
  | "error";

export class MeetError extends Error {
  constructor(readonly reason: EndReason, message?: string) {
    super(message ?? reason);
  }
}

// Never "Switch here": when the bot's account is already in the call on another
// device, that button moves that person out of the meeting.
const JOIN_BUTTON = /^(join now|ask to join|join here too|join anyway)$/i;
const DISMISS_BUTTON = /^(continue without microphone and camera|got it|dismiss)$/i;

export async function readState(page: Page): Promise<MeetState> {
  return (await page.evaluate("window.__xyneMeetBot.state()")) as MeetState;
}

async function clickIfVisible(page: Page, name: RegExp): Promise<string | null> {
  const button = page.getByRole("button", { name }).first();
  if (!(await button.isVisible().catch(() => false))) return null;
  if (!(await button.isEnabled().catch(() => false))) return null;
  const label = (await button.innerText().catch(() => "")).trim();
  await button.click({ timeout: 5_000 });
  return label;
}

/**
 * Gets from the pre-join screen into the meeting (or its lobby).
 * Returns "asked" when the bot is waiting to be admitted.
 */
export async function joinMeeting(
  page: Page,
  options: { botName: string; allowGuest: boolean; timeoutMs?: number },
): Promise<"joined" | "asked"> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    await clickIfVisible(page, DISMISS_BUTTON).catch(() => null);
    const state = await readState(page);
    if (state.inCall) return "joined";
    if (state.notFound) throw new MeetError("meeting_not_found");
    if (state.blocked) throw new MeetError("blocked", "Google refused the join (\"You can't join this video call\")");
    if (state.nameInput) {
      if (!options.allowGuest) throw new MeetError("not_signed_in", "Meet shows the bot signed out");
      const input = page.locator('input[aria-label="Your name"]');
      if ((await input.inputValue().catch(() => "")) !== options.botName) await input.fill(options.botName);
    }
    const clicked = await clickIfVisible(page, JOIN_BUTTON).catch(() => null);
    if (clicked) return /ask/i.test(clicked) ? "asked" : "joined";
    await page.waitForTimeout(1_000);
  }
  throw new MeetError("join_button_not_found", "Could not find Meet's join button");
}

/** Waits in the lobby until admitted, refused, cancelled or timed out. */
export async function waitUntilInCall(page: Page, timeoutMs: number, isCancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new MeetError("cancelled");
    const state = await readState(page);
    if (state.inCall) return;
    if (state.denied) throw new MeetError("denied");
    if (state.notAdmitted) throw new MeetError("not_admitted");
    if (state.blocked) throw new MeetError("blocked");
    await page.waitForTimeout(1_000);
  }
  throw new MeetError("waiting_room_timeout");
}

/**
 * Starts handing the meeting's mixed audio to `onAudio`: base64 16-bit mono PCM at
 * 48 kHz, tagged with who Meet shows as speaking (null when nobody).
 */
export async function startCapture(
  page: Page,
  onAudio: (base64Pcm: string, speaker: Speaker | null) => void,
): Promise<void> {
  await page.exposeFunction("__xyneAudio", (base64Pcm: string, key: unknown, name: unknown) =>
    onAudio(
      base64Pcm,
      typeof key === "string" && key ? { key, name: typeof name === "string" && name ? name : "Participant" } : null,
    ),
  );
  await page.evaluate("window.__xyneMeetBot.startCapture()");
}

export async function leaveMeeting(page: Page): Promise<void> {
  await page.evaluate("window.__xyneMeetBot.stopCapture()").catch(() => undefined);
  await page.locator('[aria-label^="Leave call"]').first().click({ timeout: 3_000 }).catch(() => undefined);
}
