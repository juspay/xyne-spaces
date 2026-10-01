import { useRef, type ReactElement } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CHUNK_IN_S, nextRevealState, type RevealState } from './instructionsChunks';

/** Ease-out cubic. */
const CHUNK_EASE = [0.33, 1, 0.68, 1] as const;

/**
 * The Instructions field while the Build chat writes it. The page adds a few
 * lines at a time (instructionsChunks.ts), and each addition blurs in where it
 * lands. The textarea comes back when the turn ends, with the same text in the
 * same place.
 */
export function InstructionsReveal({
  text,
  className,
}: {
  text: string;
  /** Typography and spacing of the textarea it stands in for. */
  className?: string;
}): ReactElement {
  const reduceMotion = useReducedMotion();
  const stateRef = useRef<RevealState | null>(null);
  // Derived during render so a new part mounts with the text that brings it.
  // Idempotent for the same text, so a repeated render changes nothing.
  stateRef.current = nextRevealState(stateRef.current, text);
  const { parts } = stateRef.current;

  return (
    <div className={className} aria-busy='true' data-testid='instructions-reveal'>
      {parts.length === 0 ? (
        // Mounted as writing starts, so even the first chunk blurs in. Until it
        // lands, a shimmering line holds the field's place.
        <span data-shimmer-text>Writing instructions…</span>
      ) : null}
      {parts.map(part =>
        part.animate ? (
          <motion.span
            key={part.key}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(8px)' }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, filter: 'blur(0px)' }}
            transition={{
              duration: reduceMotion ? 0.2 : CHUNK_IN_S,
              // Gentler than the chat's ease-out: the blur clears over the whole fade.
              ease: CHUNK_EASE,
              delay: reduceMotion ? 0 : part.delay,
            }}
          >
            {part.text}
          </motion.span>
        ) : (
          <span key={part.key}>{part.text}</span>
        ),
      )}
    </div>
  );
}
