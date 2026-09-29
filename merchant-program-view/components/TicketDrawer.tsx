import { PRI_LABEL, STATUS_LABEL, type Drawer } from '../lib/drawer';
import { Avatar, DONE_COLOR, PAL, PriorityIcon, SECTION_LABEL, StatusGlyph, ageColor, pressable, toneColor } from './primitives';

/**
 * Merchant watch's own view of a ticket, shown as a collapsible section in the ticket panel: why it
 * needs attention, timing and linked tickets.
 */
export function WatchDetails({ dt, onOpen }: { dt: Drawer; onOpen: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {dt.flags.map((f, i) => (
        <div key={`${f.type}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '9px 12px', borderRadius: 8, background: PAL[f.sev].bg, border: `1px solid ${PAL[f.sev].bd}`, }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: PAL[f.sev].c }}>{f.label}</span>
          <span style={{ fontSize: 13, color: 'var(--t2)' }}>{f.reason}</span>
        </div>
      ))}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={SECTION_LABEL}>Timing</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {dt.timing.map(c => (
            <div key={c.k} style={{ border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: 'var(--t4)' }}>{c.k}</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: toneColor(c.tone, c.v), fontVariantNumeric: 'tabular-nums' }}>{c.v}</span>
              <span style={{ fontSize: 12, color: 'var(--t4)' }}>{c.sub}</span>
            </div>
          ))}
        </div>
      </section>

      {dt.links.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={SECTION_LABEL}>Linked tickets</span>
          {dt.links.map(l => {
            const ac = l.open ? ageColor(l.d) : DONE_COLOR;
            return (
              <div
                key={l.id}
                className="hov"
                {...pressable(() => onOpen(l.id))}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
              >
                <span data-tip={`${l.stage} · ${STATUS_LABEL[l.st]}`} style={{ display: 'inline-flex', marginTop: 3 }}>
                  <StatusGlyph st={l.st} size={13} />
                </span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)' }}>{l.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--t4)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <span data-tip={`Priority · ${PRI_LABEL[l.pri]}`} style={{ display: 'inline-flex' }}>
                      <PriorityIcon pri={l.pri} />
                    </span>
                    <span className="mono">{l.key}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      · {l.rel} · {l.stage}
                    </span>
                  </span>
                </div>
                {/* Assignee top right, age under it. */}
                <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span data-tip={l.who} style={{ display: 'inline-flex' }}>
                    {l.who === 'Unassigned' ? (
                      <span style={{ width: 18, height: 18, boxSizing: 'border-box', borderRadius: '50%', border: '1px dashed var(--t5)' }} />
                    ) : (
                      <Avatar name={l.who} size={18} />
                    )}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: ac.c }}>{l.age}</span>
                </div>
              </div>
            );
          })}
        </section>
      )}

    </div>
  );
}

