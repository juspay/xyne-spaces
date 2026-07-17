import type { ReactElement, ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  CornerDownRight,
  FileText,
  Globe,
  Hash,
  Inbox,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  Mic,
  Phone,
  PieChart,
  Search,
  Settings,
  Sparkles,
  Ticket,
  User,
} from 'lucide-react';
import { MockFrame } from './MockFrame';

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Shared primitives — actual Xyne Spaces design tokens                       */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Avatar — rounded-md matches real UserAvatar shape */
export const Av = ({ initials, color }: { initials: string; color: string }): ReactElement => (
  <div
    className={`h-5 w-5 rounded-md flex items-center justify-center shrink-0 text-[9px] font-bold text-white ${color}`}
  >
    {initials}
  </div>
);

/** Unread badge — --sidebar-badge-accent = #57ab02 */
export const UnreadBadge = ({ n }: { n: number }): ReactElement => (
  <span className='h-[14px] min-w-[14px] px-[3px] rounded-full bg-[#57ab02] text-white text-[8px] font-bold flex items-center justify-center leading-none'>
    {n}
  </span>
);

/** Ticket/status badge — exact hex from global.css */
export const TBadge = ({ label }: { label: string }): ReactElement => {
  const styles: Record<string, string> = {
    Open: 'bg-[#f5f7fa] text-[#525866] border border-[#e1e4ea]',
    'In Review': 'bg-[#eff6ff] text-[#193cb8] border border-[#dbeafe]',
    Resolved: 'bg-[#f0fdf4] text-[#00a63e] border border-[#dcfce7]',
    Failed: 'bg-[#fef2f2] text-[#e7000b] border border-[#ffe2e2]',
    Running: 'bg-[#eff6ff] text-[#193cb8] border border-[#dbeafe]',
    Pending: 'bg-[#f5f7fa] text-[#525866] border border-[#e1e4ea]',
    Done: 'bg-[#f0fdf4] text-[#00a63e] border border-[#dcfce7]',
    Active: 'bg-[#f0fdf4] text-[#00a63e] border border-[#dcfce7]',
    'On Hold': 'bg-[#fffbeb] text-[#b45309] border border-[#fde68a]',
    Connected: 'bg-[#f0fdf4] text-[#00a63e] border border-[#dcfce7]',
    'Not connected': 'bg-[#f5f7fa] text-[#525866] border border-[#e1e4ea]',
    Admin: 'bg-[#eff6ff] text-[#193cb8] border border-[#dbeafe]',
    Member: 'bg-[#f0fdf4] text-[#00a63e] border border-[#dcfce7]',
    'Read-only': 'bg-[#f5f7fa] text-[#525866] border border-[#e1e4ea]',
    Shared: 'bg-[#eff6ff] text-[#193cb8] border border-[#dbeafe]',
    LIVE: 'bg-[#f0fdf4] text-[#00a63e] border border-[#dcfce7]',
  };
  const cls = styles[label] ?? 'bg-[#f5f7fa] text-[#525866] border border-[#e1e4ea]';
  return (
    <span
      className={`text-[9px] font-medium px-1.5 py-[2px] rounded-full whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
};

/* ─── Layout atoms ──────────────────────────────────────────────────────── */

/** Narrow AppSidebar icon rail */
export const IconRail = ({ active }: { active: string }): ReactElement => {
  const items: Array<{ key: string; icon: ReactElement }> = [
    { key: 'chat', icon: <Inbox size={13} /> },
    { key: 'calls', icon: <Phone size={13} /> },
    { key: 'tickets', icon: <Ticket size={13} /> },
    { key: 'insights', icon: <PieChart size={13} /> },
    { key: 'analytics', icon: <BarChart2 size={13} /> },
    { key: 'ai', icon: <Brain size={13} /> },
  ];
  return (
    <div className='w-8 shrink-0 flex flex-col items-center gap-1 pt-2 bg-sidebar border-r border-sidebar-divider'>
      {items.map(item => (
        <div
          key={item.key}
          className={`h-8 w-8 flex items-center justify-center rounded-lg ${
            active === item.key ? 'bg-appSidebar-active text-[#27699d]' : 'text-muted-foreground/40'
          }`}
        >
          {item.icon}
        </div>
      ))}
    </div>
  );
};

/** ChatDirectory panel — bg-sidebar */
export const ChatDir = ({
  activeItem,
  channels,
}: {
  activeItem?: string;
  channels?: Array<{ name: string; unread?: number }>;
}): ReactElement => {
  const navItems = [
    { key: 'activity', label: 'Activity', icon: <Megaphone size={11} /> },
    { key: 'bookmarks', label: 'Bookmarks', icon: <BookOpen size={11} /> },
    { key: 'dms', label: 'DMs', icon: <MessageCircle size={11} /> },
    { key: 'threads', label: 'Threads', icon: <CornerDownRight size={11} /> },
    { key: 'recap', label: 'Recap', icon: <Sparkles size={11} /> },
  ];
  const chList = channels ?? [
    { name: 'general', unread: 0 },
    { name: 'engineering', unread: 3 },
    { name: 'incidents', unread: 0 },
    { name: 'product', unread: 0 },
  ];
  return (
    <div className='w-[106px] shrink-0 bg-sidebar border-r border-sidebar-divider flex flex-col pt-1 pb-1 overflow-hidden'>
      <p className='text-[11px] font-semibold text-sidebar-primary-foreground px-2 pb-1'>Chat</p>
      {navItems.map(n => (
        <div
          key={n.key}
          className={`flex items-center gap-1.5 h-7 px-2 rounded-md mx-0.5 text-[10px] cursor-default ${
            activeItem === n.key
              ? 'bg-sidebar-item-active text-sidebar-primary-foreground font-medium'
              : 'text-sidebar-secondary-foreground'
          }`}
        >
          {n.icon}
          <span className='truncate'>{n.label}</span>
        </div>
      ))}
      <p className='text-[9px] font-semibold text-sidebar-secondary-foreground px-2 pt-1.5 pb-0.5 uppercase tracking-wide'>
        Channels
      </p>
      {chList.map(ch => (
        <div
          key={ch.name}
          className={`flex items-center gap-1 h-7 px-2 rounded-md mx-0.5 text-[10px] cursor-default ${
            activeItem === ch.name
              ? 'bg-sidebar-item-active text-sidebar-primary-foreground font-medium'
              : 'text-sidebar-secondary-foreground'
          }`}
        >
          <Hash size={9} className='shrink-0 opacity-60' />
          <span className='flex-1 truncate'>{ch.name}</span>
          {ch.unread ? <UnreadBadge n={ch.unread} /> : null}
        </div>
      ))}
    </div>
  );
};

/** Message row — matches MessageBubble */
export const Msg = ({
  initials,
  color,
  name,
  time,
  children,
  replies,
}: {
  initials: string;
  color: string;
  name: string;
  time: string;
  children: ReactNode;
  replies?: number;
}): ReactElement => (
  <div className='px-2 py-0.5 hover:bg-accent/30 rounded-sm'>
    <div className='flex items-start gap-1.5'>
      <Av initials={initials} color={color} />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-1'>
          <span className='text-[10px] font-semibold text-foreground'>{name}</span>
          <span className='text-[9px] text-muted-foreground'>{time}</span>
        </div>
        <div className='text-[10px] text-foreground/90 leading-relaxed'>{children}</div>
        {replies !== undefined && (
          <span className='text-[9px] text-[#57ab02] font-medium cursor-pointer'>
            {replies} replies
          </span>
        )}
      </div>
    </div>
  </div>
);

/** Compose bar */
export const MsgBar = ({ placeholder = 'Message...' }: { placeholder?: string }): ReactElement => (
  <div className='mx-2 mb-1.5 mt-auto rounded-lg border border-border bg-background px-2 py-1 flex items-center'>
    <span className='text-[10px] text-muted-foreground/50 flex-1'>{placeholder}</span>
  </div>
);

/** Channel / DM header */
export const ChanHeader = ({
  name,
  isChannel = true,
}: {
  name: string;
  isChannel?: boolean;
}): ReactElement => (
  <div className='h-9 border-b border-border flex items-center px-3 gap-1 shrink-0 bg-background'>
    {isChannel && <Hash size={11} className='text-muted-foreground' />}
    <span className='text-[11px] font-semibold text-foreground'>{name}</span>
  </div>
);

/** Screen-level header */
export const ScreenHeader = ({ title, pill }: { title: string; pill?: string }): ReactElement => (
  <div className='h-9 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-background'>
    <span className='text-[11px] font-semibold text-foreground'>{title}</span>
    {pill && (
      <span className='text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium'>
        {pill}
      </span>
    )}
  </div>
);

/** Full app shell: icon rail + content */
export const Shell = ({
  railActive,
  children,
}: {
  railActive: string;
  children: ReactNode;
}): ReactElement => (
  <div className='flex h-full'>
    <IconRail active={railActive} />
    <div className='flex-1 bg-background overflow-hidden flex flex-col'>{children}</div>
  </div>
);

/** Chat shell: icon rail + ChatDir + content */
export const ChatShell = ({
  activeNav,
  activeChannel,
  children,
  channels,
}: {
  activeNav?: string;
  activeChannel?: string;
  children: ReactNode;
  channels?: Array<{ name: string; unread?: number }>;
}): ReactElement => (
  <div className='flex h-full'>
    <IconRail active='chat' />
    <ChatDir
      {...((activeNav ?? activeChannel) !== undefined
        ? { activeItem: activeNav ?? activeChannel }
        : {})}
      {...(channels !== undefined ? { channels } : {})}
    />
    <div className='flex-1 bg-background flex flex-col overflow-hidden'>{children}</div>
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────── */
/*  FeatureMock                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

interface FeatureMockProps {
  visualKey: string;
  title: string;
}

export const FeatureMock = ({ visualKey, title }: FeatureMockProps): ReactElement => {
  switch (visualKey) {
    /* GROUP A — Chat ─────────────────────────────────────────────────────── */

    case 'chat':
      return (
        <MockFrame title={title}>
          <ChatShell activeChannel='engineering'>
            <ChanHeader name='engineering' />
            <div className='flex-1 py-1 space-y-0.5 overflow-hidden'>
              <Msg initials='AC' color='bg-violet-500' name='Alice Chen' time='9:04 AM' replies={3}>
                Pushed the API migration to staging ✅
              </Msg>
              <Msg initials='BK' color='bg-sky-500' name='Bob Kumar' time='9:07 AM'>
                Nice! Running smoke tests now
              </Msg>
              <Msg initials='MR' color='bg-rose-500' name='Maya Rao' time='9:09 AM'>
                Staging looks good — ready for review 👍
              </Msg>
            </div>
            <MsgBar placeholder='Message #engineering' />
          </ChatShell>
        </MockFrame>
      );

    case 'dms':
      return (
        <MockFrame title={title}>
          <ChatShell activeNav='dms'>
            <ChanHeader name='Alice Chen' isChannel={false} />
            <div className='flex-1 py-1 space-y-0.5 overflow-hidden'>
              <Msg initials='AC' color='bg-violet-500' name='Alice Chen' time='9:15 AM'>
                Can you review PR #48?
              </Msg>
              <Msg initials='Me' color='bg-slate-500' name='You' time='9:16 AM'>
                On it — checking this morning
              </Msg>
              <Msg initials='AC' color='bg-violet-500' name='Alice Chen' time='9:18 AM'>
                Thanks! No rush 🙏
              </Msg>
            </div>
            <MsgBar placeholder='Message Alice Chen' />
          </ChatShell>
        </MockFrame>
      );

    case 'threads':
      return (
        <MockFrame title={title}>
          <ChatShell activeNav='threads'>
            <ScreenHeader title='Threads' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                {
                  ch: '#engineering',
                  snippet: 'API migration update — need sign-off',
                  replies: 5,
                  time: '9:04 AM',
                },
                {
                  ch: '#product',
                  snippet: 'Q2 roadmap feedback requested',
                  replies: 3,
                  time: '8:30 AM',
                },
                {
                  ch: '#incidents',
                  snippet: 'DB timeout resolved — RCA drafted',
                  replies: 8,
                  time: 'Yesterday',
                },
              ].map(t => (
                <div key={t.ch} className='border border-border rounded-lg p-1.5 space-y-0.5'>
                  <span className='text-[9px] font-semibold text-[#57ab02]'>{t.ch}</span>
                  <p className='text-[10px] text-foreground/90 leading-tight'>{t.snippet}</p>
                  <span className='text-[9px] text-muted-foreground'>
                    {t.replies} replies · {t.time}
                  </span>
                </div>
              ))}
            </div>
          </ChatShell>
        </MockFrame>
      );

    case 'activity':
      return (
        <MockFrame title={title}>
          <ChatShell activeNav='activity'>
            <ScreenHeader title='Activity' />
            <div className='flex-1 p-1.5 space-y-0.5 overflow-hidden'>
              {[
                { icon: '💬', text: 'Alice Chen replied in #engineering', time: '2m ago' },
                { icon: '👍', text: 'Bob Kumar reacted to your message', time: '15m ago' },
                { icon: '@', text: 'You were mentioned in #incidents', time: '1h ago' },
              ].map((item, i) => (
                <div
                  key={i}
                  className='flex items-start gap-1.5 p-1.5 rounded-md hover:bg-sidebar-item-hover'
                >
                  <span className='text-[11px] leading-none mt-0.5'>{item.icon}</span>
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] text-foreground/90 leading-tight'>{item.text}</p>
                    <span className='text-[9px] text-muted-foreground'>{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </ChatShell>
        </MockFrame>
      );

    case 'bookmarks':
      return (
        <MockFrame title={title}>
          <ChatShell activeNav='bookmarks'>
            <ScreenHeader title='Bookmarks' />
            <div className='flex-1 p-1.5 space-y-1 overflow-hidden'>
              {[
                { ch: '#engineering', text: 'Deploy checklist for v2.0 release', date: 'Apr 21' },
                { ch: '#product', text: 'Q2 OKRs finalized — doc link inside', date: 'Apr 19' },
                {
                  ch: '#incidents',
                  text: 'DB runbook — connection pool tuning tips',
                  date: 'Apr 15',
                },
              ].map((b, i) => (
                <div
                  key={i}
                  className='flex items-start gap-1.5 p-1.5 rounded-md border border-border/60'
                >
                  <span className='text-amber-500 text-[11px] mt-0.5'>🔖</span>
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] text-foreground/90 truncate leading-tight'>
                      {b.text}
                    </p>
                    <span className='text-[9px] text-muted-foreground'>
                      {b.ch} · {b.date}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ChatShell>
        </MockFrame>
      );

    case 'recap':
      return (
        <MockFrame title={title}>
          <ChatShell activeNav='recap'>
            <ScreenHeader title='Recap' />
            <div className='flex-1 p-1.5 space-y-1.5 overflow-hidden'>
              <div className='flex items-center gap-1 mb-0.5'>
                <Sparkles size={10} className='text-[#57ab02]' />
                <span className='text-[10px] font-semibold text-foreground'>Since yesterday</span>
              </div>
              {[
                { ch: '#engineering', summary: '14 messages · API migration merged' },
                { ch: '#product', summary: '6 messages · Q2 roadmap approved' },
                { ch: '#incidents', summary: '22 messages · Outage resolved 03:47 UTC' },
              ].map((r, i) => (
                <div key={i} className='p-1.5 rounded-lg bg-muted/40'>
                  <span className='text-[9px] font-semibold text-[#57ab02]'>{r.ch}</span>
                  <p className='text-[10px] text-foreground/80 mt-0.5 leading-tight'>{r.summary}</p>
                </div>
              ))}
            </div>
          </ChatShell>
        </MockFrame>
      );

    case 'emoji-reactions':
      return (
        <MockFrame title={title}>
          <ChatShell activeChannel='engineering'>
            <ChanHeader name='engineering' />
            <div className='flex-1 py-1 overflow-hidden'>
              <Msg initials='AC' color='bg-violet-500' name='Alice Chen' time='9:04 AM'>
                Deploy to staging is complete ✅
              </Msg>
              <div className='flex items-center gap-1 pl-9 pt-0.5 flex-wrap'>
                {[
                  { emoji: '👍', count: 4, active: true },
                  { emoji: '🎉', count: 2, active: false },
                  { emoji: '🚀', count: 1, active: false },
                ].map(r => (
                  <button
                    key={r.emoji}
                    type='button'
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border ${
                      r.active
                        ? 'bg-[#57ab02]/10 border-[#57ab02] text-[#57ab02]'
                        : 'bg-muted border-border text-muted-foreground'
                    }`}
                  >
                    <span>{r.emoji}</span>
                    <span className='font-medium'>{r.count}</span>
                  </button>
                ))}
                <button
                  type='button'
                  className='flex items-center px-1.5 py-0.5 rounded-full text-[10px] border border-border bg-muted text-muted-foreground'
                >
                  + React
                </button>
              </div>
            </div>
            <MsgBar placeholder='Message #engineering' />
          </ChatShell>
        </MockFrame>
      );

    /* GROUP B — Calls & Recordings ──────────────────────────────────────── */

    case 'calls':
      return (
        <MockFrame title={title}>
          <Shell railActive='calls'>
            <ScreenHeader title='Calls' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                {
                  title: 'Daily Standup',
                  participants: 'AC, BK, MR',
                  duration: '18 min',
                  live: false,
                },
                {
                  title: 'Product Review',
                  participants: 'AC, +4',
                  duration: '42 min',
                  live: false,
                },
                {
                  title: 'Incident Bridge',
                  participants: 'BK, MR',
                  duration: 'Active',
                  live: true,
                },
              ].map((c, i) => (
                <div
                  key={i}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <div
                    className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${c.live ? 'bg-[#57ab02]/10 text-[#57ab02]' : 'bg-muted text-muted-foreground'}`}
                  >
                    <Phone size={12} />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] font-medium text-foreground'>{c.title}</p>
                    <span className='text-[9px] text-muted-foreground'>
                      {c.participants} · {c.duration}
                    </span>
                  </div>
                  {c.live && <TBadge label='LIVE' />}
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'recordings':
      return (
        <MockFrame title={title}>
          <Shell railActive='calls'>
            <ScreenHeader title='Recordings' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                { title: 'Product Review · Apr 22', duration: '42:17', speakers: 'AC, BK, MR, +2' },
                { title: 'Daily Standup · Apr 23', duration: '18:04', speakers: 'AC, BK, MR' },
                { title: 'Incident Bridge · Apr 22', duration: '1:04:32', speakers: 'BK, MR' },
              ].map((r, i) => (
                <div
                  key={i}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <div className='h-7 w-7 rounded-md bg-[#57ab02]/10 text-[#57ab02] flex items-center justify-center shrink-0'>
                    <Mic size={12} />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] font-medium text-foreground truncate'>{r.title}</p>
                    <span className='text-[9px] text-muted-foreground'>
                      {r.duration} · {r.speakers}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'call-recording-share':
      return (
        <MockFrame title={title}>
          <Shell railActive='calls'>
            <ScreenHeader title='Product Review · Apr 22' />
            <div className='flex-1 p-2 space-y-2 overflow-hidden'>
              <div className='flex items-center gap-2 rounded-lg border border-border/60 p-1.5'>
                <div className='h-6 w-6 rounded-md bg-[#57ab02]/10 text-[#57ab02] flex items-center justify-center shrink-0'>
                  <Mic size={11} />
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-1 mt-0.5'>
                    <div className='flex-1 rounded-full bg-muted h-[5px]'>
                      <div className='h-full rounded-full bg-[#57ab02] w-[40%]' />
                    </div>
                    <span className='text-[9px] text-muted-foreground shrink-0'>17:02 / 42:17</span>
                  </div>
                </div>
              </div>
              <div className='space-y-1'>
                <p className='text-[9px] font-semibold text-muted-foreground uppercase tracking-wide'>
                  Transcript
                </p>
                {[
                  {
                    time: '17:01',
                    init: 'AC',
                    color: 'bg-violet-500',
                    line: 'Migration is done on staging—',
                  },
                  {
                    time: '17:04',
                    init: 'BK',
                    color: 'bg-sky-500',
                    line: 'Load tests pass at 2x traffic.',
                  },
                ].map((t, i) => (
                  <div key={i} className='flex items-start gap-1.5'>
                    <span className='text-[9px] text-muted-foreground font-mono shrink-0'>
                      {t.time}
                    </span>
                    <Av initials={t.init} color={t.color} />
                    <p className='text-[9px] text-foreground/80 flex-1 leading-tight'>{t.line}</p>
                  </div>
                ))}
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'scheduled':
      return (
        <MockFrame title={title}>
          <Shell railActive='chat'>
            <ScreenHeader title='Scheduled Messages' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                {
                  to: '#general',
                  preview: 'Weekly update: migration complete 🎉',
                  sendAt: 'Mon 9:00 AM',
                },
                {
                  to: 'Alice Chen',
                  preview: 'Reminder: review PR #48 today',
                  sendAt: 'Today 2:00 PM',
                },
              ].map((s, i) => (
                <div key={i} className='rounded-lg border border-border/60 p-2 space-y-1'>
                  <div className='flex items-center justify-between'>
                    <span className='text-[9px] font-semibold text-[#57ab02]'>{s.to}</span>
                    <div className='flex items-center gap-1 text-muted-foreground'>
                      <CalendarClock size={9} />
                      <span className='text-[9px]'>{s.sendAt}</span>
                    </div>
                  </div>
                  <p className='text-[10px] text-foreground/90 truncate'>{s.preview}</p>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    /* GROUP C — Tickets & Support ────────────────────────────────────────── */

    case 'tickets':
      return (
        <MockFrame title={title}>
          <Shell railActive='tickets'>
            <ScreenHeader title='Tickets' />
            <div className='flex items-center gap-1 px-3 py-1.5 border-b border-border overflow-x-hidden'>
              {['All', 'Open', 'In Review', 'Resolved'].map((tab, i) => (
                <button
                  key={tab}
                  type='button'
                  className={`h-6 px-2 text-[9px] font-medium rounded-full whitespace-nowrap ${
                    i === 0
                      ? 'bg-[#57ab02]/10 border border-[#57ab02] text-[#57ab02]'
                      : 'text-muted-foreground border border-transparent'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className='flex-1 p-2 space-y-1 overflow-hidden'>
              {[
                {
                  id: '#1024',
                  title: 'Bug: API timeout on checkout',
                  init: 'AC',
                  color: 'bg-violet-500',
                  status: 'Open',
                },
                {
                  id: '#1023',
                  title: 'Feature: dark mode toggle',
                  init: 'BK',
                  color: 'bg-sky-500',
                  status: 'In Review',
                },
                {
                  id: '#1022',
                  title: 'Docs: update auth flow guide',
                  init: 'MR',
                  color: 'bg-rose-500',
                  status: 'Resolved',
                },
              ].map(t => (
                <div
                  key={t.id}
                  className='flex items-center gap-1.5 p-1.5 rounded-lg border border-border/60'
                >
                  <span className='text-[9px] font-mono text-muted-foreground w-10 shrink-0'>
                    {t.id}
                  </span>
                  <p className='flex-1 truncate text-[10px] text-foreground/90'>{t.title}</p>
                  <Av initials={t.init} color={t.color} />
                  <TBadge label={t.status} />
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'my-tickets':
      return (
        <MockFrame title={title}>
          <Shell railActive='tickets'>
            <ScreenHeader title='My Tickets' />
            <div className='flex-1 p-2 space-y-1 overflow-hidden'>
              {[
                { id: '#1024', title: 'Bug: API timeout on checkout', status: 'Open' },
                { id: '#1021', title: 'Investigate auth edge case', status: 'In Review' },
                { id: '#1018', title: 'Update onboarding documentation', status: 'Pending' },
              ].map(t => (
                <div
                  key={t.id}
                  className='flex items-center gap-1.5 p-1.5 rounded-lg border border-border/60'
                >
                  <span className='text-[9px] font-mono text-muted-foreground w-10 shrink-0'>
                    {t.id}
                  </span>
                  <p className='flex-1 truncate text-[10px] text-foreground/90'>{t.title}</p>
                  <TBadge label={t.status} />
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'ticket-detail':
      return (
        <MockFrame title={title}>
          <Shell railActive='tickets'>
            <div className='flex-1 p-3 overflow-hidden space-y-2'>
              <div className='flex items-start gap-2'>
                <div className='flex-1 min-w-0'>
                  <p className='text-[11px] font-semibold text-foreground leading-tight'>
                    Bug: API timeout on checkout
                  </p>
                  <span className='text-[9px] font-mono text-muted-foreground'>#1024</span>
                </div>
                <TBadge label='Open' />
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-[9px] text-muted-foreground'>Assignee</span>
                <Av initials='AC' color='bg-violet-500' />
                <span className='text-[10px] text-foreground/80'>Alice Chen</span>
              </div>
              <div className='rounded-lg border border-border/60 bg-muted/30 p-1.5 space-y-0.5'>
                <div className='h-2 rounded-full bg-muted-foreground/30 w-[90%]' />
                <div className='h-2 rounded-full bg-muted-foreground/20 w-full' />
                <div className='h-2 rounded-full bg-muted-foreground/20 w-[75%]' />
              </div>
              <p className='text-[9px] font-semibold text-muted-foreground uppercase tracking-wide'>
                Activity
              </p>
              <div className='flex items-start gap-1.5'>
                <Av initials='BK' color='bg-sky-500' />
                <div className='flex-1 min-w-0 rounded-lg bg-muted/40 px-2 py-1'>
                  <p className='text-[9px] text-foreground/80 leading-relaxed'>
                    Reproduced locally — pool limit hit under 200 rps
                  </p>
                </div>
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'ticket-views':
      return (
        <MockFrame title={title}>
          <Shell railActive='tickets'>
            <div className='flex h-full overflow-hidden'>
              <div className='w-[90px] shrink-0 bg-sidebar border-r border-sidebar-divider pt-2 px-1 space-y-0.5'>
                <p className='text-[9px] font-semibold text-sidebar-secondary-foreground uppercase px-1 pb-0.5 tracking-wide'>
                  Views
                </p>
                {['All Open', 'High Priority', 'My Tickets', 'Unassigned'].map((v, i) => (
                  <div
                    key={v}
                    className={`text-[9px] px-2 py-1 rounded-md cursor-default ${
                      i === 0
                        ? 'bg-sidebar-item-active text-sidebar-primary-foreground font-medium'
                        : 'text-sidebar-secondary-foreground'
                    }`}
                  >
                    {v}
                  </div>
                ))}
              </div>
              <div className='flex-1 flex flex-col'>
                <ScreenHeader title='All Open' />
                <div className='flex-1 p-1.5 space-y-1 overflow-hidden'>
                  {[
                    { id: '#1024', title: 'API timeout on checkout', status: 'Open' },
                    { id: '#1023', title: 'Dark mode toggle', status: 'Open' },
                    { id: '#1020', title: 'Export CSV broken', status: 'Open' },
                  ].map(t => (
                    <div
                      key={t.id}
                      className='flex items-center gap-1.5 p-1 rounded border border-border/60'
                    >
                      <span className='text-[8px] font-mono text-muted-foreground w-8 shrink-0'>
                        {t.id}
                      </span>
                      <p className='flex-1 truncate text-[9px] text-foreground/90'>{t.title}</p>
                      <TBadge label={t.status} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'support':
      return (
        <MockFrame title={title}>
          <Shell railActive='tickets'>
            <ScreenHeader title='Support Queue' />
            <div className='flex-1 p-2 space-y-1 overflow-hidden'>
              {[
                {
                  id: 'SRT-042',
                  user: 'John D.',
                  issue: 'Cannot log in to the app',
                  sla: '2h left',
                  urgent: true,
                },
                {
                  id: 'SRT-041',
                  user: 'Priya M.',
                  issue: 'Export CSV not working',
                  sla: '5h left',
                  urgent: false,
                },
                {
                  id: 'SRT-040',
                  user: 'Tom W.',
                  issue: 'Notification delay issue',
                  sla: 'On time',
                  urgent: false,
                },
              ].map(s => (
                <div
                  key={s.id}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <LifeBuoy
                    size={11}
                    className={
                      s.urgent ? 'text-rose-500 shrink-0' : 'text-muted-foreground shrink-0'
                    }
                  />
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] text-foreground/90 truncate leading-tight'>
                      {s.issue}
                    </p>
                    <span className='text-[9px] text-muted-foreground'>{s.user}</span>
                  </div>
                  <div className='flex items-center gap-0.5 text-muted-foreground shrink-0'>
                    <Clock size={9} />
                    <span className={`text-[9px] ${s.urgent ? 'text-rose-500 font-medium' : ''}`}>
                      {s.sla}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'workflows':
      return (
        <MockFrame title={title}>
          <Shell railActive='tickets'>
            <ScreenHeader title='Ticket Workflow' pill='#1024' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                { step: 'Assign to on-call engineer', status: 'done' },
                { step: 'Notify #incidents channel', status: 'done' },
                { step: 'Create RCA draft', status: 'running' },
                { step: 'Close linked alerts', status: 'pending' },
              ].map((w, i) => (
                <div key={i} className='flex items-center gap-2'>
                  {w.status === 'done' ? (
                    <CheckCircle2 size={12} className='text-[#57ab02] shrink-0' />
                  ) : w.status === 'running' ? (
                    <div className='h-3 w-3 rounded-full border-2 border-[#57ab02] border-t-transparent animate-spin shrink-0' />
                  ) : (
                    <Circle size={12} className='text-muted-foreground/40 shrink-0' />
                  )}
                  <span
                    className={`text-[10px] ${w.status === 'pending' ? 'text-muted-foreground/60' : 'text-foreground/90'}`}
                  >
                    {w.step}
                  </span>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    /* GROUP D — Projects ─────────────────────────────────────────────────── */

    case 'projects-board':
      return (
        <MockFrame title={title}>
          <Shell railActive='analytics'>
            <ScreenHeader title='Platform Migration' pill='Kanban' />
            <div className='flex-1 p-2 overflow-hidden'>
              <div className='grid grid-cols-3 gap-1.5 h-full'>
                {[
                  { col: 'To Do', cards: ['Design login screen', 'Write API docs'] },
                  { col: 'In Progress', cards: ['Dark mode toggle', 'Migrate to v2 API'] },
                  { col: 'Done', cards: ['Auth refactor', 'Fix checkout bug'] },
                ].map(({ col, cards }) => (
                  <div key={col} className='rounded-md bg-muted/40 p-1.5 space-y-1'>
                    <span className='text-[9px] font-semibold text-muted-foreground uppercase tracking-wide'>
                      {col}
                    </span>
                    {cards.map(card => (
                      <div
                        key={card}
                        className='rounded bg-background border border-border/60 px-1.5 py-1'
                      >
                        <p className='text-[9px] text-foreground/90 leading-tight'>{card}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'list-projects':
      return (
        <MockFrame title={title}>
          <Shell railActive='analytics'>
            <ScreenHeader title='Projects' />
            <div className='flex-1 p-2 overflow-hidden'>
              <div className='space-y-0.5'>
                <div className='grid grid-cols-[1fr_auto_auto] gap-x-2 pb-1'>
                  {['Project', 'Owner', 'Status'].map(h => (
                    <span
                      key={h}
                      className='text-[9px] font-semibold uppercase text-muted-foreground'
                    >
                      {h}
                    </span>
                  ))}
                </div>
                {[
                  { name: 'Mobile App v2.0', init: 'AC', color: 'bg-violet-500', status: 'Active' },
                  {
                    name: 'Platform Migration',
                    init: 'BK',
                    color: 'bg-sky-500',
                    status: 'On Hold',
                  },
                  { name: 'Design System', init: 'MR', color: 'bg-rose-500', status: 'Active' },
                ].map(p => (
                  <div
                    key={p.name}
                    className='grid grid-cols-[1fr_auto_auto] gap-x-2 items-center py-1 border-t border-border/40'
                  >
                    <span className='text-[10px] text-foreground/90 truncate'>{p.name}</span>
                    <Av initials={p.init} color={p.color} />
                    <TBadge label={p.status} />
                  </div>
                ))}
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    /* GROUP E — Search, Canvas, Docs ─────────────────────────────────────── */

    case 'search':
      return (
        <MockFrame title={title}>
          <div className='space-y-1.5'>
            <div className='flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 py-1.5'>
              <Search size={11} className='text-muted-foreground' />
              <span className='text-[10px] text-muted-foreground'>API timeout</span>
            </div>
            <div className='space-y-0.5'>
              {[
                {
                  type: 'Message',
                  text: '#incidents · "API timeout on checkout route"',
                  time: 'Apr 22',
                },
                { type: 'Ticket', text: '#1024 · Bug: API timeout on checkout', time: 'Open' },
                { type: 'Person', text: 'Alice Chen · alice@xyne.app', time: '' },
              ].map((r, i) => (
                <div key={i} className='flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/50'>
                  <span className='text-[8px] font-semibold text-muted-foreground uppercase w-11 shrink-0'>
                    {r.type}
                  </span>
                  <p className='text-[10px] text-foreground/90 flex-1 truncate'>{r.text}</p>
                  {r.time && (
                    <span className='text-[9px] text-muted-foreground shrink-0'>{r.time}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </MockFrame>
      );

    case 'canvas':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Q2 Product Roadmap' pill='Canvas' />
            <div className='flex-1 p-3 space-y-1.5 overflow-hidden'>
              <div className='flex items-center gap-1.5 mb-1'>
                <span className='text-[11px] font-semibold text-foreground'>
                  Q2 Product Roadmap
                </span>
                <TBadge label='Shared' />
              </div>
              <div className='h-2.5 rounded-full bg-foreground/70 w-[55%]' />
              <div className='h-1.5 rounded-full bg-muted w-full' />
              <div className='h-1.5 rounded-full bg-muted w-[90%]' />
              <div className='h-1.5 rounded-full bg-muted w-[75%]' />
              <div className='mt-2 h-2.5 rounded-full bg-foreground/70 w-[40%]' />
              <div className='h-1.5 rounded-full bg-muted w-full' />
              <div className='h-1.5 rounded-full bg-muted w-[80%]' />
            </div>
          </Shell>
        </MockFrame>
      );

    /* GROUP F — AI & Intelligence ────────────────────────────────────────── */

    case 'xyne-ai':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Xyne AI' />
            <div className='flex-1 p-2 space-y-2 overflow-hidden'>
              <div className='flex items-start gap-1.5'>
                <Av initials='Me' color='bg-slate-500' />
                <div className='flex-1 rounded-lg bg-muted/50 px-2 py-1'>
                  <p className='text-[10px] text-foreground/90'>
                    Summarize what happened in #incidents today
                  </p>
                </div>
              </div>
              <div className='flex items-start gap-1.5'>
                <div className='h-5 w-5 rounded-md bg-[#57ab02]/10 text-[#57ab02] flex items-center justify-center shrink-0'>
                  <Sparkles size={10} />
                </div>
                <div className='flex-1 rounded-lg bg-muted/40 border border-border/60 px-2 py-1 space-y-0.5'>
                  <p className='text-[9px] font-semibold text-[#57ab02]'>Xyne AI</p>
                  <p className='text-[10px] text-foreground/90 leading-relaxed'>
                    1 incident today: API timeout (#1024). Alice pushed a fix at 09:14, Bob
                    confirmed at 09:32. RCA in progress.
                  </p>
                </div>
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'agents':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Agents' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                { name: 'Support Bot', desc: 'Auto-responds in #customer-support', active: true },
                {
                  name: 'Code Review Agent',
                  desc: 'Reviews PRs and posts summaries',
                  active: true,
                },
                { name: 'Standup Bot', desc: 'Collects daily standups at 9 AM', active: false },
              ].map(a => (
                <div
                  key={a.name}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <div className='h-7 w-7 rounded-md bg-[#57ab02]/10 text-[#57ab02] flex items-center justify-center shrink-0'>
                    <Bot size={12} />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] font-medium text-foreground'>{a.name}</p>
                    <p className='text-[9px] text-muted-foreground truncate'>{a.desc}</p>
                  </div>
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 ${a.active ? 'bg-[#57ab02]' : 'bg-muted-foreground/30'}`}
                  />
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'knowledge-base':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Knowledge Base' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              <div className='flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 py-1'>
                <Search size={10} className='text-muted-foreground' />
                <span className='text-[10px] text-muted-foreground'>Search docs…</span>
              </div>
              {[
                { title: 'API Documentation', tags: 'Engineering', updated: 'Apr 22' },
                { title: 'Onboarding Guide', tags: 'HR', updated: 'Apr 18' },
                { title: 'Engineering Runbook', tags: 'Ops', updated: 'Apr 15' },
              ].map(d => (
                <div
                  key={d.title}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <FileText size={11} className='text-muted-foreground shrink-0' />
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] text-foreground/90 truncate'>{d.title}</p>
                    <span className='text-[9px] text-muted-foreground'>
                      {d.tags} · {d.updated}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'memory':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Context Memory' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                {
                  title: 'Platform migration decision',
                  note: 'Postgres over MySQL decided Apr 2025',
                },
                { title: 'On-call rotation', note: 'Alice leads P0 response; Bob as backup' },
                { title: 'Release cadence', note: 'Deploys every Tue & Thu at 14:00 UTC' },
              ].map((m, i) => (
                <div key={i} className='rounded-lg border border-border/60 p-2 space-y-0.5'>
                  <p className='text-[10px] font-medium text-foreground'>{m.title}</p>
                  <p className='text-[9px] text-muted-foreground leading-relaxed'>{m.note}</p>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'ai-onboarding':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Getting Started with Xyne AI' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                { step: 'Connect tools (Google Drive, GitHub)', done: true },
                { step: 'Add team members', done: true },
                { step: 'Review suggested memories', done: false },
                { step: 'Configure AI response style', done: false },
              ].map((s, i) => (
                <div key={i} className='flex items-center gap-2'>
                  {s.done ? (
                    <CheckCircle2 size={12} className='text-[#57ab02] shrink-0' />
                  ) : (
                    <Circle size={12} className='text-muted-foreground/40 shrink-0' />
                  )}
                  <span
                    className={`text-[10px] ${s.done ? 'line-through text-muted-foreground' : 'text-foreground/90'}`}
                  >
                    {s.step}
                  </span>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    /* GROUP G — Analytics & Insights ─────────────────────────────────────── */

    case 'insights':
      return (
        <MockFrame title={title}>
          <Shell railActive='insights'>
            <ScreenHeader title='Product Insights' />
            <div className='flex-1 p-2 space-y-2 overflow-hidden'>
              <div className='grid grid-cols-3 gap-1.5'>
                {[
                  { label: 'Messages', value: '2,340', delta: '+12%', up: true },
                  { label: 'Resolved', value: '87', delta: '+5%', up: true },
                  { label: 'Call hrs', value: '14h', delta: '-2%', up: false },
                ].map(m => (
                  <div key={m.label} className='rounded-lg bg-muted/50 p-1.5 text-center'>
                    <p className='text-[11px] font-semibold text-foreground'>{m.value}</p>
                    <p className='text-[9px] text-muted-foreground'>{m.label}</p>
                    <p
                      className={`text-[9px] font-medium ${m.up ? 'text-[#57ab02]' : 'text-rose-500'}`}
                    >
                      {m.delta}
                    </p>
                  </div>
                ))}
              </div>
              <div className='flex items-end gap-1 h-10'>
                {[30, 55, 40, 70, 60, 80, 65].map((h, i) => (
                  <div
                    key={i}
                    className='flex-1 rounded-t bg-[#57ab02]/25 min-h-[4px]'
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className='flex justify-between'>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <span key={d} className='text-[8px] text-muted-foreground'>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'analytics':
      return (
        <MockFrame title={title}>
          <Shell railActive='analytics'>
            <ScreenHeader title='Analytics' />
            <div className='flex-1 p-2 space-y-2 overflow-hidden'>
              <div className='grid grid-cols-2 gap-1.5'>
                {[
                  { label: 'Tickets Resolved', value: '87', delta: '+5%', up: true },
                  { label: 'Avg Response', value: '1.4h', delta: '-12%', up: true },
                ].map(m => (
                  <div key={m.label} className='rounded-lg bg-muted/40 p-1.5'>
                    <p className='text-[9px] text-muted-foreground'>{m.label}</p>
                    <p className='text-[13px] font-semibold text-foreground'>{m.value}</p>
                    <p className='text-[9px] text-[#57ab02] font-medium'>{m.delta} vs last wk</p>
                  </div>
                ))}
              </div>
              <div className='flex items-end gap-1 h-10'>
                {[40, 65, 50, 80, 70, 90, 75].map((h, i) => (
                  <div
                    key={i}
                    className='flex-1 rounded-t bg-[#57ab02]/25 min-h-[4px]'
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'analytics-dashboard':
      return (
        <MockFrame title={title}>
          <Shell railActive='analytics'>
            <ScreenHeader title='Weekly Engineering Health' />
            <div className='flex-1 p-2 space-y-2 overflow-hidden'>
              <div className='grid grid-cols-2 gap-1.5'>
                <div className='rounded-lg border border-border/60 bg-muted/30 p-1.5'>
                  <p className='text-[9px] text-muted-foreground mb-1'>Tickets by Assignee</p>
                  <div className='space-y-1'>
                    {[
                      { init: 'AC', color: 'bg-violet-500', pct: 55 },
                      { init: 'BK', color: 'bg-sky-500', pct: 30 },
                      { init: 'MR', color: 'bg-rose-500', pct: 15 },
                    ].map(r => (
                      <div key={r.init} className='flex items-center gap-1'>
                        <Av initials={r.init} color={r.color} />
                        <div className='flex-1 rounded-full bg-muted h-1.5'>
                          <div
                            className='h-full rounded-full bg-[#57ab02]/60'
                            style={{ width: `${r.pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className='rounded-lg border border-border/60 bg-muted/30 p-1.5'>
                  <p className='text-[9px] text-muted-foreground mb-1'>Resolution Time</p>
                  <div className='flex items-end gap-0.5 h-8'>
                    {[30, 50, 40, 70, 55].map((h, i) => (
                      <div
                        key={i}
                        className='flex-1 rounded-t bg-[#57ab02]/40 min-h-[4px]'
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    /* GROUP H — Admin ────────────────────────────────────────────────────── */

    case 'user-groups':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='User Groups' />
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              {[
                {
                  name: 'Engineering',
                  count: 8,
                  members: [
                    { i: 'AC', c: 'bg-violet-500' },
                    { i: 'BK', c: 'bg-sky-500' },
                  ],
                },
                {
                  name: 'Customer Success',
                  count: 5,
                  members: [
                    { i: 'MR', c: 'bg-rose-500' },
                    { i: 'AC', c: 'bg-violet-500' },
                  ],
                },
                {
                  name: 'Leadership',
                  count: 3,
                  members: [
                    { i: 'BK', c: 'bg-sky-500' },
                    { i: 'MR', c: 'bg-rose-500' },
                  ],
                },
              ].map(g => (
                <div
                  key={g.name}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <div className='flex -space-x-1.5'>
                    {g.members.map((m, i) => (
                      <Av key={i} initials={m.i} color={m.c} />
                    ))}
                  </div>
                  <p className='text-[10px] font-medium text-foreground flex-1'>{g.name}</p>
                  <span className='text-[9px] text-muted-foreground shrink-0'>
                    {g.count} members
                  </span>
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'user-management':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='User Management' />
            <div className='flex-1 p-2 space-y-1 overflow-hidden'>
              {[
                {
                  name: 'Alice Chen',
                  email: 'alice@xyne.app',
                  role: 'Admin',
                  init: 'AC',
                  color: 'bg-violet-500',
                },
                {
                  name: 'Bob Kumar',
                  email: 'bob@xyne.app',
                  role: 'Member',
                  init: 'BK',
                  color: 'bg-sky-500',
                },
                {
                  name: 'Maya Rao',
                  email: 'maya@xyne.app',
                  role: 'Read-only',
                  init: 'MR',
                  color: 'bg-rose-500',
                },
              ].map(u => (
                <div
                  key={u.name}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <Av initials={u.init} color={u.color} />
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] font-medium text-foreground'>{u.name}</p>
                    <p className='text-[9px] text-muted-foreground truncate'>{u.email}</p>
                  </div>
                  <TBadge label={u.role} />
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'user-profile':
      return (
        <MockFrame title={title}>
          <div className='p-2'>
            <div className='rounded-xl border border-border bg-card p-3 space-y-2 shadow-sm'>
              <div className='flex items-center gap-2'>
                <div className='h-9 w-9 rounded-md bg-violet-500 flex items-center justify-center text-white text-[12px] font-bold shrink-0'>
                  AC
                </div>
                <div>
                  <p className='text-[11px] font-semibold text-foreground'>Alice Chen</p>
                  <p className='text-[9px] text-muted-foreground'>Engineering Lead</p>
                </div>
                <div className='ml-auto flex items-center gap-1'>
                  <div className='h-2 w-2 rounded-full bg-[#57ab02]' />
                  <span className='text-[9px] text-[#57ab02]'>Online</span>
                </div>
              </div>
              <div className='space-y-0.5'>
                <p className='text-[9px] text-muted-foreground'>alice@xyne.app</p>
                <p className='text-[9px] text-muted-foreground'>🕐 9:05 AM · UTC+5:30</p>
              </div>
              <button
                type='button'
                className='w-full h-6 rounded-md bg-[#57ab02] text-white text-[10px] font-medium'
              >
                Send DM
              </button>
            </div>
          </div>
        </MockFrame>
      );

    case 'jira':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Jira Migration' />
            <div className='flex-1 p-2 space-y-2 overflow-hidden'>
              <div className='flex items-center justify-between'>
                <span className='text-[10px] font-medium text-foreground'>PROJ · Platform Eng</span>
                <TBadge label='Running' />
              </div>
              <div className='rounded-full bg-muted overflow-hidden h-2'>
                <div className='h-full bg-[#57ab02] rounded-full' style={{ width: '68%' }} />
              </div>
              <div className='flex justify-between text-[9px] text-muted-foreground'>
                <span>340 / 500 tickets</span>
                <span>68%</span>
              </div>
              <div className='grid grid-cols-2 gap-1 text-[9px]'>
                <div className='rounded bg-muted/40 px-1.5 py-1'>
                  <p className='text-muted-foreground'>Mapped fields</p>
                  <p className='font-semibold text-foreground'>12 / 14</p>
                </div>
                <div className='rounded bg-muted/40 px-1.5 py-1'>
                  <p className='text-muted-foreground'>Errors</p>
                  <p className='font-semibold text-rose-500'>2</p>
                </div>
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    case 'apps':
      return (
        <MockFrame title={title}>
          <Shell railActive='ai'>
            <ScreenHeader title='Apps & Integrations' />
            <div className='flex-1 p-2 space-y-1 overflow-hidden'>
              {[
                { name: 'GitHub', status: 'Connected', icon: '🐙' },
                { name: 'Google Drive', status: 'Connected', icon: '📁' },
                { name: 'PagerDuty', status: 'Not connected', icon: '🔔' },
                { name: 'Slack', status: 'Not connected', icon: '💬' },
              ].map(a => (
                <div
                  key={a.name}
                  className='flex items-center gap-2 p-1.5 rounded-lg border border-border/60'
                >
                  <span className='text-[13px]'>{a.icon}</span>
                  <span className='flex-1 text-[10px] text-foreground/90'>{a.name}</span>
                  <TBadge label={a.status} />
                </div>
              ))}
            </div>
          </Shell>
        </MockFrame>
      );

    case 'forms':
      return (
        <MockFrame title={title}>
          <Shell railActive='analytics'>
            <ScreenHeader title='Forms' />
            <div className='flex-1 p-2 space-y-2 overflow-hidden'>
              <p className='text-[10px] font-semibold text-foreground'>Bug Report</p>
              <div className='space-y-1.5'>
                <div className='rounded-lg border border-border/60 bg-muted/20 px-2 py-1'>
                  <p className='text-[8px] text-muted-foreground'>Title</p>
                  <p className='text-[10px] text-foreground/80'>API timeout on checkout</p>
                </div>
                <div className='rounded-lg border border-border/60 bg-muted/20 px-2 py-1'>
                  <p className='text-[8px] text-muted-foreground'>Priority</p>
                  <p className='text-[10px] text-foreground/80'>High</p>
                </div>
              </div>
              <div className='flex items-center gap-1 text-muted-foreground pt-1 border-t border-border/40'>
                <FileText size={10} />
                <span className='text-[9px]'>12 responses this week</span>
              </div>
            </div>
          </Shell>
        </MockFrame>
      );

    /* GROUP I — Dev Tools (MockFrame only) ──────────────────────────────── */

    case 'browser':
      return (
        <MockFrame title={title}>
          <div className='space-y-1.5'>
            <div className='flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 py-1'>
              <Globe size={10} className='text-muted-foreground' />
              <div className='h-2 w-2 rounded-full bg-[#57ab02] shrink-0' />
              <span className='text-[10px] text-muted-foreground flex-1 truncate'>
                docs.github.com/en/pull-requests
              </span>
            </div>
            <div className='rounded-lg border border-border/60 bg-background p-2 space-y-1'>
              <div className='h-2.5 rounded-full bg-muted-foreground/30 w-[55%]' />
              <div className='h-1.5 rounded-full bg-muted w-full' />
              <div className='h-1.5 rounded-full bg-muted w-[88%]' />
              <div className='h-1.5 rounded-full bg-muted w-[76%]' />
            </div>
          </div>
        </MockFrame>
      );

    case 'vscode':
      return (
        <MockFrame title={title}>
          <div className='grid grid-cols-5 gap-1.5'>
            <div className='col-span-2 space-y-0.5 pt-0.5'>
              {['src/', '  auth.ts', '  api.ts', 'tests/', '  auth.test.ts'].map((f, i) => (
                <p
                  key={i}
                  className={`text-[9px] font-mono leading-tight ${f.startsWith('  ') ? 'text-foreground/80' : 'text-muted-foreground font-semibold'}`}
                >
                  {f}
                </p>
              ))}
            </div>
            <div className='col-span-3 rounded-lg border border-border/60 bg-background p-1.5 font-mono space-y-0.5'>
              <p className='text-[9px] text-blue-500'>export function</p>
              <p className='text-[9px] text-foreground/80'>{'  verifyToken(jwt) {'}</p>
              <p className='text-[9px] text-muted-foreground'>{'    // validate…'}</p>
              <p className='text-[9px] text-foreground/80'>{'  }'}</p>
            </div>
          </div>
        </MockFrame>
      );

    case 'rca':
      return (
        <MockFrame title={title}>
          <div className='space-y-1.5'>
            <div className='flex items-center gap-1.5'>
              <AlertTriangle size={12} className='text-rose-500 shrink-0' />
              <p className='text-[10px] font-semibold text-foreground'>
                API Outage · Apr 22, 02:14 UTC
              </p>
            </div>
            <div className='rounded-lg border border-border/60 bg-muted/30 p-2 space-y-0.5'>
              <p className='text-[9px] font-semibold text-muted-foreground uppercase'>Root Cause</p>
              <p className='text-[10px] text-foreground/90 leading-relaxed'>
                DB connection pool exhausted under checkout load spike
              </p>
            </div>
            <div className='space-y-1'>
              <p className='text-[9px] font-semibold text-muted-foreground uppercase'>Follow-ups</p>
              {['AC: Increase pool limit', 'BK: Add load shedding', 'MR: Update runbook'].map(
                (f, i) => (
                  <div key={i} className='flex items-center gap-1.5'>
                    <Circle size={9} className='text-muted-foreground/40 shrink-0' />
                    <span className='text-[10px] text-foreground/80'>{f}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        </MockFrame>
      );

    case 'shortcuts':
      return (
        <MockFrame title={title}>
          <div className='space-y-1.5'>
            {[
              { label: 'Global Search', keys: ['⌘', 'K'] },
              { label: 'New DM', keys: ['⌘', '⇧', 'M'] },
              { label: 'Shortcuts help', keys: ['?'] },
              { label: 'Close panel', keys: ['Esc'] },
            ].map((s, i) => (
              <div key={i} className='flex items-center justify-between'>
                <span className='text-[10px] text-foreground/90'>{s.label}</span>
                <div className='flex items-center gap-0.5'>
                  {s.keys.map(k => (
                    <kbd
                      key={k}
                      className='text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-foreground/80'
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </MockFrame>
      );

    case 'settings-panel':
      return (
        <MockFrame title={title}>
          <div className='flex h-full'>
            <div className='w-[90px] shrink-0 bg-sidebar border-r border-sidebar-divider pt-2 px-1 space-y-0.5'>
              {[
                { label: 'Appearance', icon: <Settings size={10} />, active: true },
                { label: 'Notifications', icon: <Bell size={10} />, active: false },
                { label: 'Account', icon: <User size={10} />, active: false },
              ].map(n => (
                <div
                  key={n.label}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] cursor-default ${
                    n.active
                      ? 'bg-sidebar-item-active text-sidebar-primary-foreground font-medium'
                      : 'text-sidebar-secondary-foreground'
                  }`}
                >
                  {n.icon}
                  <span className='truncate'>{n.label}</span>
                </div>
              ))}
            </div>
            <div className='flex-1 p-2 space-y-2'>
              <p className='text-[10px] font-semibold text-foreground'>Appearance</p>
              {[
                { label: 'Compact mode', on: true },
                { label: 'Show avatars', on: true },
                { label: 'Animate transitions', on: false },
              ].map(row => (
                <div key={row.label} className='flex items-center justify-between'>
                  <span className='text-[9px] text-foreground/80'>{row.label}</span>
                  <div
                    className={`h-4 w-7 rounded-full transition-colors ${row.on ? 'bg-[#57ab02]' : 'bg-muted-foreground/30'}`}
                  >
                    <div
                      className={`h-3 w-3 rounded-full bg-white mt-0.5 transition-transform ${row.on ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </MockFrame>
      );

    default:
      return (
        <MockFrame title={title}>
          <div className='rounded-lg border border-border p-3 bg-muted/30 space-y-2'>
            <div className='h-2 rounded-full bg-muted w-full' />
            <div className='h-2 rounded-full bg-muted w-[85%]' />
            <div className='h-2 rounded-full bg-muted w-[70%]' />
          </div>
        </MockFrame>
      );
  }
};
