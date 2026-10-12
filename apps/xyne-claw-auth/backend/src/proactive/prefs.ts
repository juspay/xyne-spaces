import { prisma } from "../db.js";

export interface EffectivePrefs {
  agentId: string | null;
  timezone: string;
  quietStartHour: number;
  quietEndHour: number;
  maxNudgesPerDay: number;
  replySlaHours: number;
  mutedContacts: string[];
}

export const DEFAULT_PREFS: EffectivePrefs = {
  agentId: null,
  timezone: "Asia/Kolkata",
  quietStartHour: 22,
  quietEndHour: 8,
  maxNudgesPerDay: 3,
  replySlaHours: 24,
  mutedContacts: [],
};

export function toEffectivePrefs(row: {
  agentId: string | null;
  timezone: string;
  quietStartHour: number;
  quietEndHour: number;
  maxNudgesPerDay: number;
  replySlaHours: number;
  mutedContacts: unknown;
} | null): EffectivePrefs {
  if (!row) return DEFAULT_PREFS;
  return {
    agentId: row.agentId,
    timezone: row.timezone,
    quietStartHour: row.quietStartHour,
    quietEndHour: row.quietEndHour,
    maxNudgesPerDay: row.maxNudgesPerDay,
    replySlaHours: row.replySlaHours,
    mutedContacts: Array.isArray(row.mutedContacts)
      ? row.mutedContacts.filter((c): c is string => typeof c === "string").map((c) => c.toLowerCase())
      : [],
  };
}

export async function loadPrefs(userId: string): Promise<EffectivePrefs> {
  return toEffectivePrefs(await prisma.proactivePrefs.findUnique({ where: { userId } }));
}
