import { useMemo, useState, type ReactNode } from 'react';
import { Archive, Calendar, CircleCheck, CircleDot, FileText, Flag, GitMerge, Kanban, Mail, Tag } from 'lucide-react';
import { activityItem, type ActivityIcon, type ActivityItem, type Part } from '../lib/activity';
import type { ActivityRow } from '../lib/drawer';
import { fmtDays } from '../lib/flags';
import { usePeople } from '../lib/people';
import { Avatar } from './primitives';

/** A ticket's full activity, newest first, worded like the dashboard's feed. */

const FIRST = 20;
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const exact = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const ago = (ts: number, now: number): string => (now - ts < 3_600_000 ? 'just now' : `${fmtDays((now - ts) / DAY)} ago`);

const ICONS: Record<Exclude<ActivityIcon, 'avatar'>, ReactNode> = {
  status: <CircleDot size={13} />,
  priority: <Flag size={13} />,
  tag: <Tag size={13} />,
  calendar: <Calendar size={13} />,
  subticket: <FileText size={13} color="var(--blue)" />,
  board: <Kanban size={13} />,
  archive: <Archive size={13} color="var(--amber)" />,
  merge: <GitMerge size={13} color="var(--blue)" />,
  mail: <Mail size={13} color="var(--blue)" />,
  file: <FileText size={13} />,
  check: <CircleCheck size={13} color="var(--green)" />,
};

function Icon({ it, name }: { it: ActivityItem; name: string | null }) {
  if (it.icon !== 'avatar') return <span style={{ display: 'flex', color: 'var(--t3)' }}>{ICONS[it.icon]}</span>;
  return name ? <Avatar name={name} size={16} /> : <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--bg3)' }} />;
}

/** One piece of the sentence, spaced from the one before unless it starts with punctuation. */
function PartView({ p, first }: { p: Part; first: boolean }) {
  const lead = first || (typeof p === 'string' && /^[,.:;]/.test(p)) ? '' : ' ';
  if (typeof p === 'string') return <>{lead + p}</>;
  if ('b' in p) return <>{lead}<b style={{ color: 'var(--t1)', fontWeight: 600 }}>{p.b}</b></>;
  return (
    <>
      {lead}
      {p.href ? (
        <a href={p.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>
          {p.link}
        </a>
      ) : (
        <b style={{ color: 'var(--t1)', fontWeight: 600 }}>{p.link}</b>
      )}
    </>
  );
}

export function ActivityFeed({
  rows,
  loading,
  error,
  groups,
  boardNames,
}: {
  rows: ActivityRow[] | null;
  loading: boolean;
  error: boolean;
  groups: { id: string; name: string }[];
  boardNames: Map<string, string>;
}) {
  const people = usePeople();
  const [all, setAll] = useState(false);
  const items = useMemo(() => {
    const look = {
      user: (id: string) => people.byId.get(id)?.name,
      group: (id: string) => groups.find(g => g.id === id)?.name,
      board: (id: string) => boardNames.get(id),
    };
    return (rows ?? []).slice().sort((a, b) => b.timestamp - a.timestamp).map(r => activityItem(r, look));
  }, [rows, people, groups, boardNames]);

  if (error) return <span style={{ fontSize: 13, color: 'var(--t4)' }}>Couldn't load the activity. Open the ticket in Xyne to see it.</span>;
  if (loading && !rows) return <span style={{ fontSize: 13, color: 'var(--t4)' }}>Loading activity…</span>;
  if (items.length === 0) return <span style={{ fontSize: 13, color: 'var(--t4)' }}>No activity yet.</span>;

  const now = Date.now();
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {shown.map((it, i) => (
        <div key={it.id} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 10, alignItems: 'start', paddingBottom: 12 }}>
          {/* Rail joining each icon to the next. */}
          {i < shown.length - 1 && <span style={{ position: 'absolute', left: 8.5, top: 20, bottom: 0, width: 1, background: 'var(--bd)' }} />}
          <span data-tip={it.actor ?? undefined} style={{ height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon it={it} name={it.icon === 'avatar' ? it.actor : null} />
          </span>
          <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--t3)', minWidth: 0, overflowWrap: 'anywhere' }}>
            {it.actor && <span style={{ color: 'var(--t1)', fontWeight: 500 }}>{it.actor} </span>}
            {it.parts.map((p, j) => (
              <PartView key={j} p={p} first={j === 0} />
            ))}
          </span>
          <span data-tip={exact(it.at)} style={{ fontSize: 12, lineHeight: '18px', color: 'var(--t4)', whiteSpace: 'nowrap' }}>
            {ago(it.at, now)}
          </span>
        </div>
      ))}
      {items.length > FIRST && (
        <button type="button" className="hov" onClick={() => setAll(a => !a)} style={{ all: 'unset', cursor: 'pointer', alignSelf: 'flex-start', padding: '4px 8px', margin: '0 -8px', borderRadius: 6, fontSize: 12.5, color: 'var(--t3)' }}>
          {all ? 'Show less' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
