import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** A saved group of people, named by whoever watches it. Teams are a filter
 *  shortcut, not a lens: ticking one is the same gesture as ticking each of its
 *  members, so nothing here can widen what a viewer may see. */
export interface RadarTeam {
  id: string;
  name: string;
  memberIds: string[];
}

/** Matches what the picker can comfortably show, and keeps one team from
 *  standing in for the whole workspace. */
export const MAX_TEAM_MEMBERS = 25;

const STORAGE_PREFIX = 'xyne:radar-teams';

const storageKeyFor = (userId: string): string => `${STORAGE_PREFIX}:${userId}`;

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Anything stored by an older build — or hand-edited — is read defensively:
 *  a single malformed row must not cost the viewer every other team. */
const parseTeams = (raw: unknown): RadarTeam[] => {
  if (!Array.isArray(raw)) return [];
  const teams: RadarTeam[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const t = entry as Record<string, unknown>;
    if (typeof t['id'] !== 'string' || typeof t['name'] !== 'string') continue;
    const memberIds = Array.isArray(t['memberIds'])
      ? [...new Set(t['memberIds'].filter((m): m is string => typeof m === 'string'))]
      : [];
    if (memberIds.length === 0) continue;
    teams.push({ id: t['id'], name: t['name'], memberIds: memberIds.slice(0, MAX_TEAM_MEMBERS) });
  }
  return teams;
};

const readStorage = (key: string): RadarTeam[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseTeams(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
};

const writeStorage = (key: string, teams: RadarTeam[]): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(teams));
  } catch {
    // Quota or private mode — the teams still hold for this session.
  }
};

export interface PersistedRadarTeams {
  teams: RadarTeam[];
  /** Returns the new team's id so the caller can tick it straight away. */
  createTeam: (name: string, memberIds: string[]) => string | null;
  updateTeam: (id: string, name: string, memberIds: string[]) => void;
  deleteTeam: (id: string) => void;
}

/**
 * Radar's saved teams, per user, in localStorage. They live in the browser and
 * nowhere else: a team is one viewer's private shorthand for a set of people,
 * so it does not follow them to another device and no one else can see it.
 */
export const usePersistedRadarTeams = (userId: string | undefined): PersistedRadarTeams => {
  const storageKey = userId ? storageKeyFor(userId) : null;

  const [teams, setTeams] = useState<RadarTeam[]>(() =>
    storageKey ? readStorage(storageKey) : [],
  );

  // Same late-key problem the filters hook has: the panel mounts before auth
  // necessarily has a user, and the key is the user id.
  const hydratedKeyRef = useRef<string | null>(storageKey);
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!storageKey || hydratedKeyRef.current === storageKey) return;
    hydratedKeyRef.current = storageKey;
    if (touchedRef.current) return;
    setTeams(readStorage(storageKey));
  }, [storageKey]);

  const commit = useCallback(
    (next: (prev: RadarTeam[]) => RadarTeam[]): void => {
      touchedRef.current = true;
      setTeams(prev => {
        const value = next(prev);
        if (storageKey) writeStorage(storageKey, value);
        return value;
      });
    },
    [storageKey],
  );

  const sanitize = (
    name: string,
    memberIds: string[],
  ): { name: string; memberIds: string[] } | null => {
    const trimmed = name.trim();
    const unique = [...new Set(memberIds)].slice(0, MAX_TEAM_MEMBERS);
    if (!trimmed || unique.length === 0) return null;
    return { name: trimmed, memberIds: unique };
  };

  const api = useMemo(
    () => ({
      createTeam: (name: string, memberIds: string[]): string | null => {
        const clean = sanitize(name, memberIds);
        if (!clean) return null;
        const id = newId();
        commit(prev => [...prev, { id, ...clean }]);
        return id;
      },
      updateTeam: (id: string, name: string, memberIds: string[]): void => {
        const clean = sanitize(name, memberIds);
        if (!clean) return;
        commit(prev => prev.map(t => (t.id === id ? { id, ...clean } : t)));
      },
      deleteTeam: (id: string): void => commit(prev => prev.filter(t => t.id !== id)),
    }),
    [commit],
  );

  return { teams, ...api };
};
