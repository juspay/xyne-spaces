import { useEffect, useMemo, type CSSProperties } from 'react';
import { useDialKit, type DialConfig } from 'dialkit';
import { AGENT_FACES } from './faces/agentFaces.data';

/** Version 1 is the bot-avatars canvas; Version 2 is the Figma agent faces. */
export const AGENT_AVATAR_DIAL_ID = 'agent-avatars';

const FACE_NAMES = AGENT_FACES.map(face => face.name);

/**
 * DialKit's own `persist` was not holding the picked version across reloads, so the
 * two picks are also kept here and used as the dial's defaults. That way the first
 * render already has the right version too, instead of flashing Version 1.
 */
const SAVED_KEY = 'agent-avatars:picks';
const VERSIONS = ['Version 1', 'Version 2'] as const;

function readSaved(): { version?: string; builderFace?: string } {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const saved = readSaved();
const DEFAULT_VERSION = VERSIONS.find(v => v === saved.version) ?? 'Version 1';
const DEFAULT_FACE = FACE_NAMES.find(n => n === saved.builderFace) ?? 'Pink';

/** Scan numbers and ranges match the Agent Faces handoff page. */
const AGENT_AVATAR_DIAL = {
  version: { type: 'select', options: [...VERSIONS], default: DEFAULT_VERSION },
  builderFace: { type: 'select', options: FACE_NAMES, default: DEFAULT_FACE },
  scan: {
    eyeX: [2.4, 0, 4.5, 0.1],
    eyeY: [1.3, 0, 3, 0.1],
    follow: [0.3, 0, 0.6, 0.05],
    lean: [5, 0, 12, 0.5],
    breathe: [0.08, 0, 0.16, 0.01],
    lag: [0.12, 0, 0.4, 0.02],
    loop: [4.2, 2.5, 8, 0.1],
  },
} as const satisfies DialConfig;

export type AgentAvatarDial = {
  version: 1 | 2;
  /** Face index for the fixed builder spots (Laya thinking, the draft profile). */
  builderFace: number;
  /** `--af-*` overrides for the working loop. */
  scanStyle: CSSProperties;
};

export function useAgentAvatarDial(): AgentAvatarDial {
  const dial = useDialKit('Agent Avatars', AGENT_AVATAR_DIAL, {
    id: AGENT_AVATAR_DIAL_ID,
    persist: true,
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVED_KEY,
        JSON.stringify({ version: dial.version, builderFace: dial.builderFace }),
      );
    } catch {
      /* storage blocked: the pick just won't survive a reload */
    }
  }, [dial.version, dial.builderFace]);
  const { eyeX, eyeY, follow, lean, breathe, lag, loop } = dial.scan;
  const scanStyle = useMemo(
    () =>
      /* eslint-disable @typescript-eslint/naming-convention */
      ({
        '--af-ex': `${eyeX}px`,
        '--af-ey': `${eyeY}px`,
        '--af-bf': follow,
        '--af-bt': `${lean}deg`,
        '--af-br': breathe,
        '--af-lag': `${lag}s`,
        '--af-dur': `${loop}s`,
      }) as CSSProperties,
    /* eslint-enable @typescript-eslint/naming-convention */
    [eyeX, eyeY, follow, lean, breathe, lag, loop],
  );
  return {
    version: dial.version === 'Version 2' ? 2 : 1,
    builderFace: Math.max(0, FACE_NAMES.indexOf(dial.builderFace)),
    scanStyle,
  };
}
