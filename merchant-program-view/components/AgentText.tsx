import { useId } from 'react';

/** Rendering for agent answers, and the Xyne AI mark used on every AI feature. */

/** Xyne AI's four-point star (same shape and gradient as the dashboard's XyneAIStar). */
export function XyneAIStar({ size = 16 }: { size?: number }) {
  const id = `xai-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <path
        d="M7.27143 15.2409C7.26996 12.6631 6.89499 11.1104 6.00967 10.1694C5.13445 9.23917 3.58587 8.72653 0.726533 8.72653C0.325075 8.72653 0.000340076 8.40138 0 8C0 7.59833 0.324865 7.27143 0.726533 7.27143C3.5859 7.27143 5.13445 6.75882 6.00967 5.82854C6.89478 4.88743 7.27 3.33479 7.27143 0.757059C7.27144 0.747035 7.27144 0.736583 7.27143 0.726533C7.27166 0.325027 7.59849 0 8 0C8.40122 0.000339949 8.7263 0.325237 8.72653 0.726533C8.72654 0.737114 8.72654 0.748536 8.72653 0.759094C8.72813 3.33547 9.10364 4.8876 9.9883 5.82854C10.8634 6.75873 12.4126 7.27134 15.2714 7.27143C15.6731 7.27143 16 7.59833 16 8C15.9997 8.40138 15.6729 8.72653 15.2714 8.72653C12.4126 8.72663 10.8634 9.23923 9.9883 10.1694C9.10322 11.1105 8.72801 12.6634 8.72653 15.2409C8.72653 15.251 8.72653 15.2633 8.72653 15.2735C8.72585 15.6744 8.40094 15.9997 8 16C7.59877 16 7.27212 15.6746 7.27143 15.2735C7.27144 15.2633 7.27144 15.251 7.27143 15.2409Z"
        fill={`url(#${id})`}
      />
      <defs>
        <linearGradient id={id} x1="8" y1="0" x2="8" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF6B9D" />
          <stop offset="100%" stopColor="#FFA06B" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Inline formatting of one line: **bold**, *italic* and `code`; everything else plain text. Never HTML. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/).map((seg, j) =>
        seg.startsWith('**') && seg.endsWith('**') && seg.length > 4 ? (
          <b key={j} style={{ fontWeight: 600, color: 'var(--t1)' }}>{seg.slice(2, -2)}</b>
        ) : seg.startsWith('`') && seg.endsWith('`') && seg.length > 2 ? (
          <code key={j} className="mono" style={{ fontSize: '0.88em', padding: '0 4px', borderRadius: 4, background: 'var(--bg3)' }}>{seg.slice(1, -1)}</code>
        ) : seg.startsWith('*') && seg.endsWith('*') && seg.length > 2 ? (
          <i key={j}>{seg.slice(1, -1)}</i>
        ) : (
          seg
        ),
      )}
    </>
  );
}

/** An agent's answer: bullet lines as a list with soft markers, other lines as paragraphs; headings dropped to plain text. */
export function AgentText({ text }: { text: string }) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^#+\s*/, ''));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {lines.map((line, i) => {
        const bullet = /^([-*•]|\d+[.)])\s+/.exec(line);
        if (!bullet) return <p key={i} style={{ margin: 0 }}><Inline text={line} /></p>;
        return (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: 'linear-gradient(180deg, #FF6B9D, #FFA06B)', transform: 'translateY(-2px)' }} />
            <span style={{ minWidth: 0 }}>
              <Inline text={line.slice(bullet[0].length)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** An agent's answer: running, answered, or failed. */
export type AskState = { status: 'running' } | { status: 'done'; text: string; at?: number } | { status: 'error'; text: string };
