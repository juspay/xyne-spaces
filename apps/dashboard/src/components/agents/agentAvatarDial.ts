import { useMemo, type CSSProperties } from 'react';
import { useDialKit, type DialConfig } from 'dialkit';
import { AGENT_FACES } from './faces/agentFaces.data';

/** Version 1 is the bot-avatars canvas; Version 2 is the Figma agent faces. */
export const AGENT_AVATAR_DIAL_ID = 'agent-avatars';

const FACE_NAMES = AGENT_FACES.map(face => face.name);

/** Scan numbers and ranges match the Agent Faces handoff page. */
const AGENT_AVATAR_DIAL = {
  version: { type: 'select', options: ['Version 1', 'Version 2'], default: 'Version 1' },
  builderFace: { type: 'select', options: FACE_NAMES, default: 'Pink' },
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
