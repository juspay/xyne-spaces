import { superpositionClient } from '@/services/superpositionClient';

export const CALENDAR_SYNC_LOOKAHEAD_DAYS = 30;
export const MAX_CALENDAR_EVENTS_PER_SYNC = 100;
export const CALENDAR_INCREMENTAL_CONTINUATION_DELAY_MS = 5_000;

const XYNE_TEAM_ELIGIBILITY_FLAG_KEY = 'xyne-team-domains';

export interface TeamEligibilityConfig {
  /** Email domains eligible for Xyne Call auto-injection, e.g. "juspay.in". */
  domains: string[];
  /** UserProfile.team values eligible for Xyne Call auto-injection. */
  teams: string[];
}

const EMPTY_ELIGIBILITY_CONFIG: TeamEligibilityConfig = { domains: [], teams: [] };

/**
 * Single Superposition (CAC) key gating Xyne Call auto-injection eligibility
 * (see Xyne Call Link Auto-Injection PRD, FR-2). Value shape:
 *   { "domains": ["juspay.in"], "teams": ["Xyne"] }
 * Sourced from Superposition instead of a plain env var so it can be
 * toggled/rolled out without a redeploy. Missing, empty, malformed, or
 * unreachable config is treated as "feature disabled" — never throws.
 */
export async function getTeamEligibilityConfig(): Promise<TeamEligibilityConfig> {
  if (!superpositionClient.isReady()) return EMPTY_ELIGIBILITY_CONFIG;
  try {
    const raw = await superpositionClient.getObjectValue(XYNE_TEAM_ELIGIBILITY_FLAG_KEY, {
      domains: [],
      teams: [],
    });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_ELIGIBILITY_CONFIG;

    const obj = raw as Record<string, unknown>;
    const normalizeList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim().toLowerCase())
            .filter((v) => v.length > 0)
        : [];

    return { domains: normalizeList(obj.domains), teams: normalizeList(obj.teams) };
  } catch {
    return EMPTY_ELIGIBILITY_CONFIG;
  }
}

/**
 * Whether the given organizer is eligible for Xyne Call auto-injection:
 * eligible when either their email domain OR their UserProfile team
 * (case-insensitive) is present in the CAC-configured allowlist.
 */
export async function isTeamEligible(params: {
  email?: string | null;
  team?: string | null;
}): Promise<boolean> {
  const { domains, teams } = await getTeamEligibilityConfig();
  if (domains.length === 0 && teams.length === 0) return false;

  const emailDomain = params.email?.trim().toLowerCase().split('@')[1];
  if (emailDomain && domains.includes(emailDomain)) return true;

  const team = params.team?.trim().toLowerCase();
  if (team && teams.includes(team)) return true;

  return false;
}
