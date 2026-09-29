import { useState } from 'react';
import type { LoadWarning } from '../lib/types';

const SHOWN = 5;

/** Sources that failed to load, collapsed to one line until opened. */
export function Warnings({ warnings, onRetry }: { warnings: LoadWarning[]; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  if (warnings.length === 0) return null;
  return (
    <div style={{ border: '1px solid var(--amberBd)', background: 'var(--amberBg)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--t2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', flex: 'none' }} />
        <span style={{ flex: 1 }}>
          Some data couldn't be loaded ({warnings.length} {warnings.length === 1 ? 'source' : 'sources'})
        </span>
        <button type="button" onClick={() => setOpen(o => !o)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--amberT)', fontWeight: 500 }}>
          {open ? 'Hide' : 'Details'}
        </button>
        <button type="button" onClick={onRetry} style={{ all: 'unset', cursor: 'pointer', color: 'var(--amberT)', fontWeight: 500 }}>
          Retry
        </button>
      </div>
      {open && (
        <ul style={{ margin: 0, paddingLeft: 30, color: 'var(--t3)' }}>
          {warnings.slice(0, SHOWN).map((w, i) => (
            <li key={`${w.key}-${i}`}>{w.message}</li>
          ))}
          {warnings.length > SHOWN && <li>…and {warnings.length - SHOWN} more.</li>}
        </ul>
      )}
    </div>
  );
}
