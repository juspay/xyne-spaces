import type { Locator, Page } from "playwright";
import { MeetError, readState } from "./meetPage.js";

/**
 * Microsoft Teams in the browser, as an anonymous guest named after the bot:
 * launcher page ("Continue on this browser") → pre-join screen (name, camera and
 * mic, which the bot turns off) → lobby until someone lets it in, or straight in.
 * Data-tid attributes are Teams' own test ids, steadier than its class names.
 */

const LAUNCHER_JOIN_ON_WEB = '[data-tid="joinOnWeb"]';
const NAME_INPUT = 'input[data-tid="prejoin-display-name-input"]';
const CAMERA_TOGGLE = '[data-tid="toggle-video"]';
const MIC_TOGGLE = '[data-tid="toggle-mute"]';
const JOIN_BUTTON = '[data-tid="prejoin-join-button"]';
const HANGUP_BUTTON = '[data-tid="hangup-main-btn"], #hangup-button, [data-tid="call-hangup"]';

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

/** Switches a camera/mic toggle off; true once it is off. */
async function switchOff(page: Page, selector: string): Promise<boolean> {
  const toggle = page.locator(selector).first();
  if (!(await isVisible(toggle))) return true;
  // The toggles are checkbox inputs (checked = on); aria attributes cover a button.
  const on = async () => {
    const checked = await toggle.isChecked().catch(() => null);
    if (checked !== null) return checked;
    const aria = (await toggle.getAttribute("aria-checked")) ?? (await toggle.getAttribute("aria-pressed"));
    return aria === "true";
  };
  if (await on()) await toggle.click({ timeout: 5_000 }).catch(() => undefined);
  return !(await on());
}

/**
 * Gets from the Teams link into the meeting or its lobby. Returns "asked" when the
 * bot is waiting in the lobby.
 */
export async function joinTeamsMeeting(
  page: Page,
  options: { botName: string; timeoutMs?: number },
): Promise<"joined" | "asked"> {
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  let clickedJoin = false;
  while (Date.now() < deadline) {
    const state = await readState(page).catch(() => null);
    if (state?.inCall) return "joined";
    if (state?.lobby) return "asked";
    if (state?.blocked) throw new MeetError("blocked", "This Teams meeting doesn't let guests join");
    if (state?.denied) throw new MeetError("denied");
    if (state?.notFound) throw new MeetError("meeting_not_found", "Teams couldn't connect to this meeting");

    const joinOnWeb = page.locator(LAUNCHER_JOIN_ON_WEB).first();
    if (await isVisible(joinOnWeb)) {
      await joinOnWeb.click({ timeout: 5_000 }).catch(() => undefined);
    } else if (!clickedJoin && (await isVisible(page.locator(NAME_INPUT).first()))) {
      const name = page.locator(NAME_INPUT).first();
      if ((await name.inputValue().catch(() => "")) !== options.botName) {
        await name.fill(options.botName, { timeout: 3_000 }).catch(() => undefined);
      }
      // Never join with the (fake) camera or mic on.
      const cameraOff = await switchOff(page, CAMERA_TOGGLE);
      const micOff = await switchOff(page, MIC_TOGGLE);
      const join = page.locator(JOIN_BUTTON).first();
      if (cameraOff && micOff && (await isVisible(join)) && (await join.isEnabled().catch(() => false))) {
        clickedJoin = await join
          .click({ timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
      }
    }
    await page.waitForTimeout(1_000);
  }
  throw new MeetError("join_button_not_found", clickedJoin ? "Teams didn't let the bot in" : "Could not find Teams' join screen");
}

export async function leaveTeamsMeeting(page: Page): Promise<void> {
  await page.evaluate("window.__xyneMeetBot.stopCapture()").catch(() => undefined);
  await page.locator(HANGUP_BUTTON).first().click({ timeout: 3_000 }).catch(() => undefined);
}
