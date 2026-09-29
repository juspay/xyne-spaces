import { PRI_LABEL, STATUS_LABEL, type Drawer } from '../lib/drawer';
import { Avatar, DONE_COLOR, PAL, PriorityIcon, SECTION_LABEL, StatusGlyph, ageColor, pressable, toneColor } from './primitives';

/**
 * Merchant watch's own view of a ticket, shown as a collapsible section in the ticket panel: why it
 * needs attention, timing, stage history, details, linked tickets and activity.
 */
export function WatchDetails({
  dt,
  loadingActivity,
  activityError,
  onOpen,
}: {
  dt: Drawer;
  loadingActivity: boolean;
  activityError: boolean;
  onOpen: (id: string) => void;
}) {
  const overdue = dt.flags.some(f => f.type === 'stageEta');
  const open = dt.st !== 'completed' && dt.st !== 'cancelled';
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

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={SECTION_LABEL}>Stage history</span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {dt.history.map((h, i) => {
            if (h.earlier) {
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 13, color: 'var(--t4)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', marginLeft: 3, border: '1.5px dashed var(--t6)' }} />
                  <span>{h.name}</span>
                </div>
              );
            }
            const dot = !h.current ? 'var(--t6)' : !open ? 'var(--green)' : overdue ? 'var(--red)' : 'var(--t1)';
            const ring = !h.current ? 'transparent' : !open ? 'var(--greenBg)' : overdue ? 'var(--redBg)' : 'var(--bg3)';
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', marginLeft: 3, background: dot, boxShadow: `0 0 0 3px ${ring}` }} />
                <span style={{ color: 'var(--t1)', fontWeight: h.current ? 600 : 400 }}>{h.name}</span>
                <span style={{ color: h.current ? (overdue && open ? 'var(--redT)' : 'var(--t3)') : 'var(--t4)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{h.days}</span>
              </div>
            );
          })}
          {loadingActivity && <span style={{ fontSize: 12, color: 'var(--t4)', padding: '4px 0' }}>Loading stage changes…</span>}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={SECTION_LABEL}>Details</span>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 9, columnGap: 12, fontSize: 13 }}>
          {dt.fields.map(f => (
            <div key={f.k} style={{ display: 'contents' }}>
              <span style={{ color: 'var(--t4)' }}>{f.k}</span>
              <span style={{ color: 'var(--t1)', minWidth: 0, overflowWrap: 'anywhere' }}>{f.v}</span>
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

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={SECTION_LABEL}>Activity</span>
        {loadingActivity && <span style={{ fontSize: 13, color: 'var(--t4)' }}>Loading activity…</span>}
        {activityError && <span style={{ fontSize: 13, color: 'var(--t4)' }}>Couldn't load the activity. Open the ticket in Xyne to see it.</span>}
        {!loadingActivity && !activityError && dt.activity.length === 0 && <span style={{ fontSize: 13, color: 'var(--t4)' }}>No activity recorded.</span>}
        {dt.activity.map((a, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 10, alignItems: 'start', fontSize: 13 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--t6)', margin: '5px 0 0 3px' }} />
            <span style={{ color: 'var(--t2)', lineHeight: 1.45 }}>{a.text}</span>
            <span style={{ color: 'var(--t5)', fontSize: 12, whiteSpace: 'nowrap' }}>{a.when}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

