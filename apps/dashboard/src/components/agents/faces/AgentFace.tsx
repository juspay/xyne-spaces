import { useEffect, useId, useState } from 'react';
import type { AnimationEvent, CSSProperties, ReactElement } from 'react';
import { AGENT_FACES, type AgentFaceArt } from './agentFaces.data';
import './agent-face.css';

/** One face per agent, hashed from its name: adding an agent never repaints anyone else's. */
export function faceIndexFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % AGENT_FACES.length;
}

function faceFor(agent: string | number): AgentFaceArt {
  const index = typeof agent === 'number' ? agent % AGENT_FACES.length : faceIndexFor(agent);
  const face = AGENT_FACES[index] ?? AGENT_FACES[0];
  if (!face) throw new Error('AGENT_FACES is empty');
  return face;
}

interface AgentFaceProps {
  /** Agent name (hashed to a face) or a face index 0-9. */
  agent: string | number;
  /** Size in px. Keep it at 16 or more; below that the eyes disappear. */
  size?: number;
  /** True while the agent is working. Only pass it where the face is meant to move (see README). */
  working?: boolean;
  /** One hop and blink on hover. */
  hello?: boolean;
  /** Disabled agent: eyes shut, dimmed, no motion. */
  asleep?: boolean;
  /** Extra inline style, e.g. `--af-*` Scan overrides from the dial. */
  style?: CSSProperties;
  className?: string;
}

/** The face's own hue (first stop of its tile gradient), mixed 75% toward black. */
function eyeColor(defs: string): string {
  const hex = /id="paint0_linear__U__"[^>]*>\s*<stop stop-color="#([0-9a-fA-F]{6})"/.exec(
    defs,
  )?.[1];
  if (!hex) return '#000';
  const channel = (i: number): string =>
    Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * 0.25)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

export function AgentFace({
  agent,
  size = 32,
  working = false,
  hello = true,
  asleep = false,
  style,
  className,
}: AgentFaceProps): ReactElement {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const face = faceFor(agent);
  const moving = working && !asleep;

  // When work stops, let the running loop finish and land at rest, instead of snapping back.
  const [looping, setLooping] = useState(moving);
  useEffect(() => {
    if (moving) setLooping(true);
    else if (asleep) setLooping(false);
  }, [moving, asleep]);
  const onIteration = (e: AnimationEvent): void => {
    if (!moving && e.animationName === 'af-gaze') setLooping(false);
  };

  const u = (s: string): string => s.replaceAll('__U__', `_${uid}`);
  const { x, y } = face;
  const svg = `<svg viewBox="${x} ${y} 30 30" style="--af-ox:${x + 15}px;--af-oy:${y + 15}px;--af-eye:${eyeColor(face.defs)}">
<defs>${u(face.defs)}<clipPath id="c_${uid}"><rect x="${x}" y="${y}" width="30" height="30" rx="10"/></clipPath></defs>
<g filter="url(#filter0_ddd_${uid})"><g clip-path="url(#c_${uid})">
<rect x="${x}" y="${y}" width="30" height="30" fill="url(#paint0_linear_${uid})"/>
${u(face.body)}
<g class="af-ef"><g class="af-ebr"><g class="af-eg"><g class="af-eb">${u(face.eyes)}</g></g></g></g>
</g><rect class="af-stroke" x="${x + 0.29}" y="${y + 0.29}" width="29.42" height="29.42" rx="9.71" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width=".58"/></g>
</svg>`;

  return (
    <span
      className={[
        'af',
        looping && 'af--working',
        hello && !asleep && 'af--hello',
        asleep && 'af--asleep',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size, ...style }}
      onAnimationIteration={onIteration}
      aria-hidden='true'
      // eslint-disable-next-line @typescript-eslint/naming-convention
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
