import type { Page } from "playwright";
import type { MeetingPlatform } from "./meetingUrl.js";
import { joinMeeting, leaveMeeting } from "./meetPage.js";
import { joinTeamsMeeting, leaveTeamsMeeting } from "./teamsPage.js";

/** How the bot gets into, and out of, one platform's meetings. */
export interface PlatformFlow {
  /** Sign in to the bot's Google account first (SSO), when that is set up. */
  googleSignIn: boolean;
  /** The page wants a camera and mic before it shows its join screen (see browser.ts). */
  fakeMediaDevices: boolean;
  join(page: Page, options: { botName: string; allowGuest: boolean }): Promise<"joined" | "asked">;
  leave(page: Page): Promise<void>;
}

export const PLATFORM_FLOWS: Record<MeetingPlatform, PlatformFlow> = {
  google_meet: {
    googleSignIn: true,
    fakeMediaDevices: false,
    join: (page, options) => joinMeeting(page, options),
    leave: leaveMeeting,
  },
  // Always a guest: the host lets it in from the lobby (or it is let straight in).
  teams: {
    googleSignIn: false,
    fakeMediaDevices: true,
    join: (page, { botName }) => joinTeamsMeeting(page, { botName }),
    leave: leaveTeamsMeeting,
  },
};
