import type { ReactionEvent } from '../hooks/useReactions';

const REACTION_FLOAT_STYLE = `
  @keyframes reaction-float {
    0%   { transform: translateY(0)      scale(1);    opacity: 1; }
    60%  { transform: translateY(-180px) scale(1.15); opacity: 1; }
    100% { transform: translateY(-280px) scale(0.9);  opacity: 0; }
  }
  .reaction-bubble { animation: reaction-float 4s ease-out forwards; }
` as const;

interface ReactionsOverlayProps {
  reactions: ReactionEvent[];
}

/**
 * Full-screen overlay that renders floating emoji reactions.
 * Each reaction floats upward and fades out over ~4 s.
 * Pointer-events are disabled so it never blocks clicks.
 * The keyframe is scoped to this component via an injected <style> tag.
 */
export function ReactionsOverlay({ reactions }: ReactionsOverlayProps): React.ReactElement {
  return (
    <div className='pointer-events-none absolute inset-0 overflow-hidden z-[55]' aria-hidden='true'>
      {/* Keyframe injected once per mount — scoped to this component */}
      <style>{REACTION_FLOAT_STYLE}</style>
      {reactions.map(r => (
        <div
          key={r.id}
          className='reaction-bubble absolute bottom-36 flex flex-col items-center gap-1'
          style={{ left: `${r.spawnX}%` }}
        >
          <span className='text-4xl drop-shadow-lg select-none' role='img' aria-label={r.emoji}>
            {r.emoji}
          </span>

          <span className='bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap max-w-[120px] truncate'>
            {r.isLocal ? 'You' : r.senderName}
          </span>
        </div>
      ))}
    </div>
  );
}
