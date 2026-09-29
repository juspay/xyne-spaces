import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Calendar, ChevronRight, Clock, Copy, ExternalLink, MoreHorizontal, Plus, SquareKanban, Tag, X } from 'lucide-react';
import type { Drawer } from '../lib/drawer';
import type { St } from '../lib/model';
import { usePeople } from '../lib/people';
import { etaState, resolveFields, stageEtaState, stageOptions, type FieldRow } from '../lib/ticketPanel';
import { useTicketPanel } from '../lib/useTicketPanel';
import { Avatar, Button, ChevronDown, PriorityIcon, SECTION_LABEL, StatusGlyph, useEscape } from './primitives';
import { CHIP, ChipX, DASHED, DateTimeEditor, FieldValueEditor, InlineText, Marker, OptionList, Pop, SelectValue, type Opt } from './TicketEditors';
import { WatchDetails } from './TicketDrawer';

/**
 * The Desk-style right-side ticket view (Details only), loaded live through the Spaces SDK and
 * editable in place: title, stage, assignee, priority, stage and ticket ETAs, labels, description,
 * type, user group and custom fields. Merchant watch's own analysis sits in a collapsible section.
 */

const ST_OF: Record<string, St> = { TODO: 'todo', STARTED: 'started', PAUSED: 'paused', COMPLETED: 'completed', CANCELLED: 'cancelled' };
const PRIORITIES: { value: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; label: string; pri: 'critical' | 'high' | 'medium' | 'low' }[] = [
  { value: 'CRITICAL', label: 'Urgent', pri: 'critical' },
  { value: 'HIGH', label: 'High', pri: 'high' },
  { value: 'MEDIUM', label: 'Medium', pri: 'medium' },
  { value: 'LOW', label: 'Low', pri: 'low' },
];
const LABEL_DOTS = ['#06b6d4', '#eab308', '#a855f7', '#22c55e', '#ec4899', '#3b82f6'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOnly = (ms: number): string => {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
const dateTime = (ms: number): string => {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};
/** Descriptions from email Desks can be HTML; show their text and leave editing to Xyne. */
const isHtml = (s: string): boolean => /<[a-z][\s\S]*>/i.test(s);
const textOf = (html: string): string => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

export function TicketPanel({
  ticketId,
  url,
  dt,
  loadingActivity,
  activityError,
  deskChannels,
  onClose,
  onOpen,
  onMerchant,
  onToast,
  onChanged,
}: {
  ticketId: string;
  url: string;
  /** Merchant watch's own view of the ticket, when it's in the model. */
  dt: Drawer | null;
  loadingActivity: boolean;
  activityError: boolean;
  deskChannels: Map<string, string>;
  onClose: () => void;
  onOpen: (id: string) => void;
  onMerchant: ((mid: string) => void) | null;
  onToast: (text: string) => void;
  /** A save landed: refresh the dashboard's copy. */
  onChanged: () => void;
}) {
  const { state, error, saving, reload, actions } = useTicketPanel(
    ticketId,
    text => {
      onToast(text);
      onChanged();
    },
    text => onToast(text),
  );
  const people = usePeople();

  useEscape(true, onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => before?.focus?.();
  }, []);

  const t = state?.ticket;
  const key = t?.xyneId ?? dt?.key ?? '';
  const title = t?.title ?? dt?.title ?? '';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(15,17,20,.18)' }} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={key}
        tabIndex={-1}
        style={{ position: 'fixed', zIndex: 21, top: 0, right: 0, bottom: 0, width: 600, maxWidth: '96%', background: 'var(--bg)', borderLeft: '1px solid var(--bd)', boxShadow: 'var(--shadowXl)', display: 'flex', flexDirection: 'column', animation: 'mpvIn .22s cubic-bezier(.4,0,.2,1)' }}
      >
        {/* Header: key chip, title, actions (Desk's thread panel header, no call/AI buttons). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 10px 16px', borderBottom: '1px solid var(--bd2)' }}>
          <button
            type="button"
            className="hov"
            data-tip="Copy key"
            onClick={() => {
              void navigator.clipboard?.writeText(key).then(
                () => onToast(`${key} copied`),
                () => onToast("Couldn't copy"),
              );
            }}
            style={{ all: 'unset', cursor: 'pointer', flex: 'none', fontSize: 12, fontWeight: 500, color: 'var(--t3)', background: 'var(--bg3)', padding: '2px 8px', borderRadius: 4 }}
          >
            {key}
          </button>
          <h3 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h3>
          {saving && <span style={{ fontSize: 12, color: 'var(--t4)' }}>Saving…</span>}
          <Pop
            align="right"
            width={200}
            trigger={(open, toggle) => (
              <IconButton label="More" open={open} onClick={toggle}>
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </IconButton>
            )}
          >
            {close => (
              <div style={{ padding: 4, display: 'flex', flexDirection: 'column' }}>
                <MenuRow
                  icon={<Copy size={15} strokeWidth={1.75} />}
                  onClick={() => {
                    close();
                    void navigator.clipboard?.writeText(url).then(
                      () => onToast('Link copied'),
                      () => onToast("Couldn't copy"),
                    );
                  }}
                >
                  Copy ticket link
                </MenuRow>
                <MenuRow icon={<ExternalLink size={15} strokeWidth={1.75} />} href={url} onClick={close}>
                  Open in Xyne
                </MenuRow>
              </div>
            )}
          </Pop>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '4px 20px 32px' }}>
          {error && !state && (
            <div style={{ marginTop: 20, padding: '12px 14px', border: '1px solid var(--redBd)', background: 'var(--redBg)', borderRadius: 8, fontSize: 13, color: 'var(--t2)', display: 'flex', gap: 10 }}>
              <span style={{ flex: 1 }}>Couldn't load this ticket. {error}</span>
              <button type="button" onClick={() => void reload()} style={{ all: 'unset', cursor: 'pointer', color: 'var(--redT)', fontWeight: 500 }}>
                Retry
              </button>
            </div>
          )}
          {!state && !error && <PanelSkeleton />}
          {state && t && <Details state={state} people={people} deskChannels={deskChannels} actions={actions} />}
          {dt && (
            <Collapsible title="Merchant watch" summary={dt.flags.length ? `${dt.flags.length} ${dt.flags.length === 1 ? 'flag' : 'flags'}` : 'nothing flagged'} dots={dt.flags.map(f => f.sev)}>
              <WatchDetails dt={dt} loadingActivity={loadingActivity} activityError={activityError} onOpen={onOpen} />
            </Collapsible>
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--bd2)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {onMerchant && dt && dt.midR.length > 0 && <Button onClick={() => onMerchant(dt.midR[0])}>View merchant</Button>}
          <Button solid href={url}>
            Open in Xyne
            <ExternalLink size={14} strokeWidth={1.75} />
          </Button>
        </div>
      </div>
    </>
  );
}

type Actions = ReturnType<typeof useTicketPanel>['actions'];
type State = NonNullable<ReturnType<typeof useTicketPanel>['state']>;

function Details({ state, people, deskChannels, actions }: { state: State; people: ReturnType<typeof usePeople>; deskChannels: Map<string, string>; actions: Actions }) {
  const t = state.ticket;
  const now = Date.now();
  const open = t.statusV2 !== 'COMPLETED' && t.statusV2 !== 'CANCELLED';
  const stages = useMemo(() => stageOptions(t.stageName, state.stages, state.transitions, state.nonLinear), [t.stageName, state.stages, state.transitions, state.nonLinear]);
  const cur = stages.find(s => s.current);
  const sEta = stageEtaState(t.stageName, state.stages, t.stageEtaEntries ?? [], now);
  const tEta = etaState(t.eta, open, now);
  const fields = useMemo(() => resolveFields(state.mapping, state.values, t.boardId), [state.mapping, state.values, t.boardId]);
  const [showEmpty, setShowEmpty] = useState(false);
  const creator = people.byId.get(t.createdBy)?.name;
  const assignee = t.assignedTo ? people.byId.get(t.assignedTo) : undefined;
  const channel = deskChannels.get(t.channelId);
  const pri = PRIORITIES.find(p => p.value === t.priority);
  const group = state.groups.find(g => g.id === t.userGroupId);
  const shownFields = showEmpty ? fields : fields.filter(f => f.values.length > 0);
  const emptyCount = fields.length - fields.filter(f => f.values.length > 0).length;
  const desc = t.description ?? '';
  const htmlDesc = isHtml(desc);

  const personOpts: Opt[] = people.list.filter(p => p.active !== false).map(p => ({ value: p.id, label: p.name, icon: <Avatar name={p.name} src={p.picture} size={20} /> }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ paddingTop: 18 }}>
        <InlineText value={t.title} onSave={v => v && actions.title(v)} style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.34 }} />
        {channel && <span style={{ display: 'block', fontSize: 12, color: 'var(--t4)', marginTop: 2 }}>Editing the title of an email Desk ticket also changes the email subject.</span>}
      </div>

      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--t3)' }}>
        <span>
          Created {dateOnly(t.createdAt)}
          {creator ? ` by ${creator}` : ''}
        </span>
        <span>·</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <SquareKanban size={14} color="#8b5cf6" strokeWidth={1.75} />
          <span style={{ color: 'var(--t1)' }}>{state.boardName ?? 'Board'}</span>
        </span>
        {channel && (
          <>
            <span>·</span>
            <span>#{channel}</span>
          </>
        )}
      </div>

      {/* Chip row, as in Desk's Details tab. */}
      <div style={{ marginTop: 10, marginBottom: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Pop
          width={300}
          trigger={(o, toggle) => (
            <button type="button" className="hov" aria-expanded={o} onClick={toggle} style={CHIP}>
              <StatusGlyph st={ST_OF[t.statusV2] ?? 'todo'} size={13} />
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{t.stageName}</span>
              <ChevronRight size={13} color="var(--t4)" />
              {cur && <span className="mono" style={{ fontSize: 11, color: 'var(--t4)' }}>{cur.label}</span>}
            </button>
          )}
        >
          {close => (
            <OptionList
              placeholder="Move to stage…"
              selected={cur?.id ?? null}
              options={stages.map(s => ({
                value: s.id,
                label: s.name,
                icon: <StatusGlyph st={ST_OF[s.status] ?? 'todo'} size={13} />,
                hint: s.current ? s.label : !s.allowed ? 'Not allowed' : s.gate ? 'Open in Xyne' : s.label,
                disabled: !s.current && (!s.allowed || s.gate !== null),
              }))}
              onPick={id => {
                close();
                const s = stages.find(x => x.id === id);
                if (s && !s.current) void actions.stage(s);
              }}
              footer={
                stages.some(s => s.gate) ? (
                  <div style={{ padding: '8px 12px', borderTop: '1px solid var(--bd)', fontSize: 12, color: 'var(--t3)' }}>Stages that need a form or an approval can be reached in Xyne.</div>
                ) : null
              }
            />
          )}
        </Pop>

        <Pop
          width={280}
          trigger={(o, toggle) => (
            <button type="button" className="hov" aria-expanded={o} onClick={toggle} style={{ ...CHIP, paddingLeft: 5 }}>
              {assignee ? <Avatar name={assignee.name} src={assignee.picture} size={20} /> : <span style={{ width: 20, height: 20, borderRadius: '50%', border: '1px dashed var(--t5)' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{assignee?.name ?? 'Unassigned'}</span>
              <ChevronRight size={13} color="var(--t4)" />
            </button>
          )}
        >
          {close => (
            <OptionList
              placeholder="Assign to…"
              selected={t.assignedTo}
              options={[{ value: '__none', label: 'Unassigned', icon: <span style={{ width: 20, height: 20, borderRadius: '50%', border: '1px dashed var(--t5)', flex: 'none' }} /> }, ...personOpts]}
              onPick={id => {
                close();
                const next = id === '__none' ? null : id;
                if (next !== t.assignedTo) void actions.assignee(next);
              }}
            />
          )}
        </Pop>

        <Pop
          width={200}
          trigger={(o, toggle) => (
            <button type="button" className="hov" aria-expanded={o} onClick={toggle} style={CHIP}>
              <PriorityIcon pri={pri?.pri ?? 'none'} size={13} />
              {pri?.label ?? 'No priority'}
              <ChevronRight size={13} color="var(--t4)" />
            </button>
          )}
        >
          {close => (
            <OptionList
              searchable={false}
              selected={t.priority}
              options={PRIORITIES.map(p => ({ value: p.value, label: p.label, icon: <PriorityIcon pri={p.pri} size={13} /> }))}
              onPick={v => {
                close();
                if (v !== t.priority) void actions.priority(v as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW');
              }}
            />
          )}
        </Pop>

        {sEta.show && sEta.stageId && (
          <Pop
            width={260}
            trigger={(o, toggle) => (
              <button type="button" className="hov" aria-expanded={o} onClick={toggle} style={sEta.eta ? { ...CHIP, borderColor: sEta.breached ? 'var(--redBd)' : 'var(--bd)' } : DASHED}>
                <Clock size={13} color={sEta.breached ? 'var(--redT)' : 'var(--t3)'} strokeWidth={1.75} />
                <span style={{ fontSize: 11.5, color: 'var(--t4)' }}>Stage</span>
                {sEta.eta ? <span style={{ color: sEta.breached ? 'var(--redT)' : 'var(--t1)' }}>{dateTime(sEta.eta)}</span> : 'Set'}
                {sEta.breached && <Marker>Breached</Marker>}
              </button>
            )}
          >
            {close => (
              <DateTimeEditor
                value={sEta.eta}
                onCancel={close}
                onSave={ms => {
                  close();
                  void actions.stageEta(ms, sEta.entryId, sEta.stageId!);
                }}
              />
            )}
          </Pop>
        )}

        <Pop
          width={260}
          trigger={(o, toggle) => (
            <button type="button" className="hov" aria-expanded={o} onClick={toggle} style={tEta.eta ? { ...CHIP, borderColor: tEta.breached ? 'var(--redBd)' : 'var(--bd)' } : DASHED}>
              <Calendar size={13} strokeWidth={1.75} color={tEta.breached ? 'var(--redT)' : 'var(--t3)'} />
              {tEta.eta ? <span style={{ color: tEta.breached ? 'var(--redT)' : 'var(--t1)' }}>{dateTime(tEta.eta)}</span> : 'Ticket ETA'}
              {tEta.breached && <Marker>Breached</Marker>}
            </button>
          )}
        >
          {close => (
            <DateTimeEditor
              value={tEta.eta}
              future
              onCancel={close}
              onSave={ms => {
                close();
                void actions.eta(ms);
              }}
            />
          )}
        </Pop>

        {t.statusV2 === 'PAUSED' && (
          <span style={{ ...DASHED, cursor: 'default' }} data-tip="Projected completion, shown while the ticket is paused">
            <Clock size={13} strokeWidth={1.75} />
            Projected <span style={{ color: 'var(--t1)' }}>—</span>
          </span>
        )}

        {(t.tagMappings ?? []).map((m, i) => (
          <span key={m.id} style={{ ...CHIP, cursor: 'default', paddingRight: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: LABEL_DOTS[i % LABEL_DOTS.length] }} />
            {m.tagName}
            <ChipX label={`Remove ${m.tagName}`} onClick={() => void actions.removeLabel(m)} />
          </span>
        ))}
        <LabelPicker state={state} onAdd={name => void actions.addLabel(name)} />
      </div>

      {/* Description */}
      <div style={{ marginTop: 8 }}>
        {htmlDesc ? (
          <p data-tip="This description has formatting; edit it in Xyne" style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--t3)', whiteSpace: 'pre-wrap' }}>
            <Clamp text={textOf(desc)} />
          </p>
        ) : (
          <InlineText
            value={desc}
            multiline
            placeholder="Add a description…"
            onSave={v => void actions.description(v)}
            display={desc ? <Clamp text={desc} /> : undefined}
            style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--t3)', whiteSpace: 'pre-wrap' }}
          />
        )}
      </div>

      <Collapsible title="Fields" open>
        <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0,1fr)', columnGap: 14, rowGap: 2, fontSize: 13.5 }}>
          <FieldRowView label="Type">
            <SelectValue value={t.ticketType} options={state.types.map(v => ({ value: v, label: v }))} placeholder="Set type" onPick={v => v && void actions.type(v)} />
          </FieldRowView>
          <FieldRowView label="User group">
            <SelectValue value={group?.id ?? null} options={state.groups.map(g => ({ value: g.id, label: g.name }))} placeholder="Set user group" clearable onPick={v => void actions.group(v)} />
          </FieldRowView>
          {t.merchantId && (
            <FieldRowView label="Merchant ID">
              <span style={{ color: 'var(--t1)' }}>{t.merchantId}</span>
            </FieldRowView>
          )}
          {shownFields.map(f => (
            <FieldRowView key={f.fieldId} label={f.name}>
              <FieldValueEditor row={f} onSave={v => void actions.field(f as FieldRow, v)} />
            </FieldRowView>
          ))}
        </div>
        {emptyCount > 0 && (
          <button type="button" className="hov" onClick={() => setShowEmpty(s => !s)} style={{ all: 'unset', cursor: 'pointer', marginTop: 6, padding: '4px 7px', borderRadius: 6, fontSize: 12.5, color: 'var(--t3)' }}>
            {showEmpty ? 'Hide empty fields' : `Show ${emptyCount} empty ${emptyCount === 1 ? 'field' : 'fields'}`}
          </button>
        )}
      </Collapsible>
    </div>
  );
}

function LabelPicker({ state, onAdd }: { state: State; onAdd: (name: string) => void }) {
  const have = new Set((state.ticket.tagMappings ?? []).map(m => m.tagName));
  const [q, setQ] = useState('');
  const shown = state.tags.filter(t => !have.has(t.name) && t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = state.tags.some(t => t.name.toLowerCase() === q.trim().toLowerCase()) || have.has(q.trim());
  return (
    <Pop
      width={250}
      trigger={(o, toggle) => (
        <button type="button" className="hov" aria-expanded={o} onClick={toggle} style={DASHED}>
          <Plus size={13} strokeWidth={1.75} />
          Label
        </button>
      )}
    >
      {close => {
        const add = (name: string): void => {
          close();
          setQ('');
          onAdd(name);
        };
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 10px', borderBottom: '1px solid var(--bd)' }}>
              <Tag size={14} color="var(--t4)" strokeWidth={1.75} />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && q.trim()) add(shown[0]?.name ?? q.trim());
                }}
                placeholder="Search or create a label…"
                aria-label="Search or create a label"
                style={{ all: 'unset', flex: 1, fontSize: 14, color: 'var(--t1)' }}
              />
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', padding: 4 }}>
              {shown.map(tag => (
                <MenuRow key={tag.id} onClick={() => add(tag.name)}>
                  {tag.name}
                </MenuRow>
              ))}
              {q.trim() && !exact && (
                <MenuRow icon={<Plus size={14} strokeWidth={1.75} />} onClick={() => add(q.trim())}>
                  Create “{q.trim()}”
                </MenuRow>
              )}
              {!shown.length && !q.trim() && <span style={{ display: 'block', padding: 8, fontSize: 13, color: 'var(--t3)' }}>No more labels</span>}
            </div>
          </div>
        );
      }}
    </Pop>
  );
}

function Clamp({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > 420 || text.split('\n').length > 5;
  return (
    <>
      <span style={more || !long ? undefined : { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            setMore(m => !m);
          }}
          style={{ all: 'unset', cursor: 'pointer', display: 'block', marginTop: 4, fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}
        >
          {more ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

function FieldRowView({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', minHeight: 34, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 34, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </>
  );
}

function Collapsible({ title, children, open: initial = false, summary, dots }: { title: string; children: ReactNode; open?: boolean; summary?: string; dots?: string[] }) {
  const [open, setOpen] = useState(initial);
  const dot: Record<string, string> = { red: 'var(--red)', amber: 'var(--amber)', watch: 'var(--t5)', ok: 'var(--green)' };
  return (
    <section style={{ marginTop: 22 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ display: 'flex', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}>
          <ChevronDown size={13} />
        </span>
        <span style={{ ...SECTION_LABEL, color: 'var(--t2)' }}>{title}</span>
        {summary && <span style={{ fontSize: 12, color: 'var(--t4)' }}>{summary}</span>}
        {dots?.slice(0, 6).map((d, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: dot[d] ?? 'var(--t5)' }} />)}
        <span style={{ flex: 1, height: 1, background: 'var(--bd2)' }} />
      </button>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </section>
  );
}

function IconButton({ label, children, onClick, open }: { label: string; children: ReactNode; onClick: () => void; open?: boolean }) {
  return (
    <button type="button" className="hov" aria-label={label} aria-expanded={open} onClick={onClick} style={{ all: 'unset', cursor: 'pointer', width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', flex: 'none' }}>
      {children}
    </button>
  );
}

function MenuRow({ children, icon, onClick, href }: { children: ReactNode; icon?: ReactNode; onClick: () => void; href?: string }) {
  const style = { all: 'unset' as const, boxSizing: 'border-box' as const, width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, padding: '0 8px', borderRadius: 4, fontSize: 14, color: 'var(--t1)' };
  if (href) {
    return (
      <a className="hov" href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} style={style}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button type="button" className="hov" onClick={onClick} style={style}>
      {icon}
      {children}
    </button>
  );
}

function PanelSkeleton() {
  const bar = (w: string | number, h = 12) => <span className="sk" style={{ display: 'block', width: w, height: h }} />;
  return (
    <div aria-busy="true" aria-label="Loading ticket" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 20 }}>
      {bar('80%', 22)}
      {bar('55%')}
      <div style={{ display: 'flex', gap: 8 }}>
        {[90, 120, 80, 110].map((w, i) => (
          <span key={i} className="sk" style={{ display: 'block', width: w, height: 27, borderRadius: 999 }} />
        ))}
      </div>
      {bar('100%')}
      {bar('92%')}
      {bar('70%')}
    </div>
  );
}
