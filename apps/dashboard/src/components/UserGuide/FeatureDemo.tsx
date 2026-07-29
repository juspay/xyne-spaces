import { useState, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MessagesSquare,
  Phone,
  Mic,
  Ticket,
  Search,
  Bot,
  Sparkles,
  Users,
  BarChart3,
  Hash,
  Plus,
  Paperclip,
  CheckCircle2,
  Circle,
  BookOpen,
  Brain,
  CalendarClock,
  ArrowRightLeft,
  Lightbulb,
  FileText,
  Headphones,
  Workflow,
  ShieldUser,
  AppWindow,
  Globe,
  FileCode2,
  ClipboardCheck,
  Wrench,
  FileAudio2,
  WandSparkles,
  FolderKanban,
  SquareKanban,
  PanelsTopLeft,
  Activity,
  PieChart,
  ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SceneConfig {
  el: ReactElement;
  cx: number; // cursor x percentage within demo content
  cy: number; // cursor y percentage within demo content
}

export interface FeatureDemoProps {
  visualKey: string;
  currentStep: number;
  title: string;
}

// ─── Primitive components ─────────────────────────────────────────────────────

const Av = ({ initials, color }: { initials: string; color: string }): ReactElement => (
  <div
    className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${color}`}
  >
    {initials}
  </div>
);

const Ring = ({ children, show = true }: { children: ReactNode; show?: boolean }): ReactElement =>
  show ? (
    <motion.div
      className='rounded ring-2 ring-primary ring-offset-1'
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  ) : (
    <>{children}</>
  );

const Appear = ({
  children,
  delay = 0.18,
}: {
  children: ReactNode;
  delay?: number;
}): ReactElement => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.22, ease: 'easeOut' }}
  >
    {children}
  </motion.div>
);

const Typing = ({ text }: { text: string }): ReactElement => {
  const [s, setS] = useState('');
  useEffect(() => {
    setS('');
    let i = 0;
    const t = setInterval(() => {
      setS(text.slice(0, ++i));
      if (i >= text.length) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [text]);
  return (
    <span>
      {s}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 0.5, repeat: Infinity }}
        className='text-primary'
      >
        |
      </motion.span>
    </span>
  );
};

// ─── Cursor overlay ───────────────────────────────────────────────────────────

const Cursor = ({ x, y }: { x: number; y: number }): ReactElement => (
  <motion.div
    className='absolute z-20 pointer-events-none'
    animate={{ left: `${x}%`, top: `${y}%` }}
    transition={{ type: 'spring', stiffness: 180, damping: 22 }}
    style={{ transform: 'translate(-50%, -50%)' }}
  >
    <div className='h-3.5 w-3.5 rounded-full bg-primary shadow-[0_0_0_2px_white,0_1px_6px_rgba(0,0,0,0.3)]' />
  </motion.div>
);

// ─── Mini sidebar ─────────────────────────────────────────────────────────────

interface SbItemProps {
  icon: ReactElement;
  label: string;
  active?: boolean;
  highlighted?: boolean;
}
const SbItem = ({ icon, label, active, highlighted }: SbItemProps): ReactElement => (
  <div
    className={`flex flex-col items-center gap-0.5 rounded p-1 w-full ${
      highlighted ? 'ring-1 ring-primary' : ''
    } ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground/70'}`}
  >
    <div className='text-current'>{icon}</div>
    <span
      className={`text-[7px] font-medium leading-none ${active ? 'text-primary' : 'text-muted-foreground/70'}`}
    >
      {label}
    </span>
  </div>
);

interface SidebarProps {
  activeKey: string;
  highlightKey?: string;
}
const Sidebar = ({ activeKey, highlightKey }: SidebarProps): ReactElement => {
  const items = [
    { key: 'chat', icon: <MessagesSquare size={12} />, label: 'Chat' },
    { key: 'tickets', icon: <Ticket size={12} />, label: 'Tickets' },
    { key: 'calls', icon: <Phone size={12} />, label: 'Calls' },
    { key: 'ai', icon: <Sparkles size={12} />, label: 'AI' },
    { key: 'analytics', icon: <BarChart3 size={12} />, label: 'Reports' },
    { key: 'apps', icon: <AppWindow size={12} />, label: 'Apps' },
  ];
  return (
    <div className='w-[44px] shrink-0 bg-muted/40 border-r border-border flex flex-col gap-0.5 py-1.5 px-1 overflow-hidden'>
      {items.map(item => (
        <SbItem
          key={item.key}
          icon={item.icon}
          label={item.label}
          active={activeKey === item.key}
          highlighted={highlightKey === item.key}
        />
      ))}
    </div>
  );
};

// ─── App shell ────────────────────────────────────────────────────────────────

const AppShell = ({
  sidebarActive,
  sidebarHighlight,
  children,
}: {
  sidebarActive: string;
  sidebarHighlight?: string;
  children: ReactNode;
}): ReactElement => (
  <div className='flex' style={{ minHeight: 164 }}>
    <Sidebar
      activeKey={sidebarActive}
      {...(sidebarHighlight !== undefined ? { highlightKey: sidebarHighlight } : {})}
    />
    <div className='flex-1 overflow-hidden'>{children}</div>
  </div>
);

// ─── Shared scene fragments ───────────────────────────────────────────────────

const chatMessages = (
  <>
    <div className='flex items-start gap-1.5'>
      <Av initials='AC' color='bg-violet-500' />
      <div>
        <div className='flex gap-1 items-baseline'>
          <span className='text-[10px] font-semibold text-foreground'>Alice Chen</span>
          <span className='text-[9px] text-muted-foreground'>9:04 AM</span>
        </div>
        <p className='text-[10px] text-foreground/90'>Pushed API migration to staging ✅</p>
      </div>
    </div>
    <div className='flex items-start gap-1.5'>
      <Av initials='BK' color='bg-sky-500' />
      <div>
        <div className='flex gap-1 items-baseline'>
          <span className='text-[10px] font-semibold text-foreground'>Bob Kumar</span>
          <span className='text-[9px] text-muted-foreground'>9:07 AM</span>
        </div>
        <p className='text-[10px] text-foreground/90'>Nice! I&apos;ll run smoke tests now</p>
      </div>
    </div>
  </>
);

// ─── Feature scene builders ───────────────────────────────────────────────────

function chatScenes(): SceneConfig[] {
  return [
    // Step 0: Click "Chat" in sidebar
    {
      cx: 4,
      cy: 22,
      el: (
        <AppShell sidebarActive='chat' sidebarHighlight='chat'>
          <div className='p-2 flex flex-col gap-1 h-full justify-center items-center'>
            <p className='text-[11px] text-muted-foreground text-center'>
              Click Chat in the sidebar
            </p>
          </div>
        </AppShell>
      ),
    },
    // Step 1: Select a channel
    {
      cx: 28,
      cy: 55,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex gap-2 text-[10px] text-muted-foreground'>
              <span className='text-foreground font-medium'>Channels</span>
              <span>DMs</span>
              <span>Threads</span>
            </div>
            <div className='flex-1 p-1 space-y-0.5 overflow-hidden'>
              {['#general', '#engineering', '#incidents', '#product'].map((ch, i) => (
                <Ring key={ch} show={i === 1}>
                  <div
                    className={`flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] ${i === 1 ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                  >
                    <Hash size={10} className='text-muted-foreground shrink-0' />
                    <span className={i === 1 ? 'text-primary font-medium' : 'text-foreground/80'}>
                      {ch.slice(1)}
                    </span>
                    {i === 0 && (
                      <span className='ml-auto h-3.5 w-3.5 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center font-bold'>
                        3
                      </span>
                    )}
                  </div>
                </Ring>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 2: Type message
    {
      cx: 70,
      cy: 93,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1'>
              <Hash size={10} className='text-muted-foreground' />
              <span className='text-[11px] font-semibold text-foreground'>engineering</span>
            </div>
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>{chatMessages}</div>
            <Ring show>
              <div className='mx-2 mb-1.5 rounded-lg border border-primary/40 bg-card px-2 py-1 flex items-center gap-1'>
                <span className='text-[10px] text-foreground/70 flex-1'>
                  <Typing text='Reviewing now, looks good 👍' />
                </span>
                <Paperclip size={9} className='text-muted-foreground' />
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 3: Reply in thread
    {
      cx: 87,
      cy: 48,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1'>
              <Hash size={10} className='text-muted-foreground' />
              <span className='text-[11px] font-semibold text-foreground'>engineering</span>
            </div>
            <div className='p-2 space-y-1.5'>
              {chatMessages}
              <Appear>
                <Ring show>
                  <div className='flex items-center gap-1 pl-7 py-0.5'>
                    <span className='text-[9px] text-primary font-medium cursor-pointer'>
                      3 replies
                    </span>
                    <span className='text-[9px] text-muted-foreground'>· Last 9:12 AM</span>
                  </div>
                </Ring>
              </Appear>
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 4: Attach file
    {
      cx: 16,
      cy: 93,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1'>
              <Hash size={10} className='text-muted-foreground' />
              <span className='text-[11px] font-semibold text-foreground'>engineering</span>
            </div>
            <div className='flex-1 p-2 space-y-1.5'>{chatMessages}</div>
            <div className='mx-2 mb-1.5 flex items-center gap-1'>
              <Ring show>
                <button type='button' className='p-1 rounded text-primary'>
                  <Paperclip size={12} />
                </button>
              </Ring>
              <div className='flex-1 rounded-lg border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground'>
                Message #engineering...
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

function dmScenes(): SceneConfig[] {
  return [
    // Step 0: DMs tab
    {
      cx: 50,
      cy: 11,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex gap-2 text-[10px]'>
              <span className='text-muted-foreground'>Channels</span>
              <Ring show>
                <span className='text-primary font-medium px-1 py-0.5 rounded'>DMs</span>
              </Ring>
            </div>
            <div className='flex-1 p-1 space-y-0.5'>
              {[
                {
                  init: 'AC',
                  color: 'bg-violet-500',
                  name: 'Alice Chen',
                  msg: 'Can you review PR #48?',
                },
                { init: 'BK', color: 'bg-sky-500', name: 'Bob Kumar', msg: 'Standup in 5 mins!' },
              ].map(dm => (
                <div
                  key={dm.name}
                  className='flex items-center gap-1.5 p-1 rounded hover:bg-muted/40'
                >
                  <Av initials={dm.init} color={dm.color} />
                  <div className='flex-1 min-w-0'>
                    <p className='text-[10px] font-semibold text-foreground'>{dm.name}</p>
                    <p className='text-[9px] text-muted-foreground truncate'>{dm.msg}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 1: New DM button
    {
      cx: 88,
      cy: 11,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center justify-between'>
              <div className='flex gap-2 text-[10px]'>
                <span className='text-muted-foreground'>Channels</span>
                <span className='text-primary font-medium'>DMs</span>
              </div>
              <Ring show>
                <button type='button' className='p-0.5 rounded text-primary bg-primary/10'>
                  <Plus size={11} />
                </button>
              </Ring>
            </div>
            <div className='flex-1 p-1 space-y-0.5'>
              {['Alice Chen', 'Bob Kumar', 'Maya Rao'].map((name, i) => (
                <div key={name} className='flex items-center gap-1.5 p-1 rounded hover:bg-muted/40'>
                  <Av
                    initials={name
                      .split(' ')
                      .map(n => n[0])
                      .join('')}
                    color={['bg-violet-500', 'bg-sky-500', 'bg-rose-500'][i] ?? 'bg-violet-500'}
                  />
                  <p className='text-[10px] font-semibold text-foreground'>{name}</p>
                </div>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 2: Search for teammate
    {
      cx: 60,
      cy: 35,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='p-2 space-y-1.5'>
              <p className='text-[10px] font-semibold text-foreground'>New Direct Message</p>
              <Ring show>
                <div className='rounded border border-primary/50 bg-card px-2 py-1 flex items-center gap-1'>
                  <Search size={10} className='text-muted-foreground' />
                  <span className='text-[10px] text-foreground/80'>
                    <Typing text='Bob Kumar' />
                  </span>
                </div>
              </Ring>
              <Appear>
                <div className='rounded border border-border/60 bg-card p-1'>
                  <div className='flex items-center gap-1.5 p-1 rounded bg-primary/5'>
                    <Av initials='BK' color='bg-sky-500' />
                    <div>
                      <p className='text-[10px] font-semibold text-foreground'>Bob Kumar</p>
                      <p className='text-[9px] text-muted-foreground'>bob@example.com</p>
                    </div>
                  </div>
                </div>
              </Appear>
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 3: DM open
    {
      cx: 70,
      cy: 88,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1.5'>
              <Av initials='BK' color='bg-sky-500' />
              <span className='text-[10px] font-semibold text-foreground'>Bob Kumar</span>
              <span className='text-[9px] text-emerald-500 font-medium'>● Online</span>
            </div>
            <div className='flex-1 p-2'>
              <div className='flex items-start gap-1.5'>
                <Av initials='BK' color='bg-sky-500' />
                <div className='rounded-lg bg-muted/50 px-2 py-1'>
                  <p className='text-[10px] text-foreground/90'>Hey! Ready for the sync?</p>
                </div>
              </div>
            </div>
            <Ring show>
              <div className='mx-2 mb-1.5 rounded-lg border border-primary/40 bg-card px-2 py-1 flex items-center gap-1'>
                <span className='text-[10px] text-foreground/70 flex-1'>
                  <Typing text='Yes, joining now!' />
                </span>
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 4: Group DM
    {
      cx: 88,
      cy: 55,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1.5'>
              <Av initials='BK' color='bg-sky-500' />
              <span className='text-[10px] font-semibold text-foreground'>Bob Kumar</span>
              <Ring show>
                <button type='button' className='ml-auto p-0.5 rounded text-primary bg-primary/10'>
                  <Plus size={10} />
                </button>
              </Ring>
            </div>
            <div className='flex-1 p-2'>
              <Appear>
                <div className='rounded-lg border border-border/60 p-1.5 text-[10px]'>
                  <p className='font-medium text-foreground mb-1'>Add to conversation</p>
                  <div className='rounded border border-primary/50 px-1.5 py-0.5 flex items-center gap-1'>
                    <Search size={9} className='text-muted-foreground' />
                    <span className='text-muted-foreground'>Search teammates...</span>
                  </div>
                </div>
              </Appear>
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

function threadsScenes(): SceneConfig[] {
  return [
    {
      cx: 50,
      cy: 11,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex gap-2 text-[10px]'>
              <span className='text-muted-foreground'>Channels</span>
              <span className='text-muted-foreground'>DMs</span>
              <Ring show>
                <span className='text-primary font-medium px-1 py-0.5 rounded'>Threads</span>
              </Ring>
            </div>
            <div className='flex-1 p-1.5 flex items-center justify-center'>
              <p className='text-[10px] text-muted-foreground'>Your thread inbox</p>
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 55,
      cy: 42,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Threads
            </div>
            <div className='p-1.5 space-y-1 flex-1'>
              {[
                { ch: '#engineering', msg: 'API migration — need sign-off', n: 5 },
                { ch: '#product', msg: 'Q2 roadmap feedback', n: 3 },
              ].map((t, i) => (
                <Ring key={t.ch} show={i === 0}>
                  <div
                    className={`rounded-lg border border-border/60 p-1.5 ${i === 0 ? 'bg-primary/5' : ''}`}
                  >
                    <span className='text-[9px] font-medium text-primary'>{t.ch}</span>
                    <p className='text-[10px] text-foreground/90 mt-0.5'>{t.msg}</p>
                    <span className='text-[9px] text-muted-foreground'>{t.n} replies</span>
                  </div>
                </Ring>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 55,
      cy: 40,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex h-full'>
            <div className='flex-1 border-r border-border p-1.5 space-y-1'>
              <div className='text-[9px] text-muted-foreground font-semibold'>#engineering</div>
              <div className='text-[10px] text-foreground/90'>API migration — need sign-off</div>
              <Appear>
                <div className='text-[9px] text-primary font-medium'>→ Jump to conversation</div>
              </Appear>
            </div>
            <div className='w-[100px] p-1.5'>
              <p className='text-[9px] font-semibold text-foreground mb-1'>Thread</p>
              <div className='flex items-start gap-1'>
                <Av initials='AC' color='bg-violet-500' />
                <p className='text-[9px] text-foreground/80'>LGTM! Merging now</p>
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 80,
      cy: 88,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex h-full'>
            <div className='flex-1 border-r border-border p-1.5'>
              <div className='text-[9px] text-muted-foreground'>#engineering</div>
              <div className='text-[10px] text-foreground/90 mt-0.5'>API migration update</div>
            </div>
            <div className='w-[100px] flex flex-col'>
              <div className='border-b border-border px-1.5 py-1 text-[9px] font-semibold text-foreground'>
                Reply
              </div>
              <div className='flex-1 p-1'>
                <div className='flex items-start gap-1 mb-1'>
                  <Av initials='AC' color='bg-violet-500' />
                  <p className='text-[9px] text-foreground/80'>LGTM! Merging</p>
                </div>
              </div>
              <Ring show>
                <div className='m-1 rounded border border-primary/50 px-1.5 py-0.5'>
                  <span className='text-[9px] text-foreground/70'>
                    <Typing text='On it!' />
                  </span>
                </div>
              </Ring>
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 87,
      cy: 40,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Threads
            </div>
            <div className='p-1.5 space-y-1'>
              {[
                { ch: '#engineering', msg: 'API migration — need sign-off', done: true },
                { ch: '#product', msg: 'Q2 roadmap feedback', done: false },
              ].map((t, i) => (
                <div
                  key={t.ch}
                  className='flex items-center gap-1.5 rounded-lg border border-border/60 p-1.5'
                >
                  <div className='flex-1'>
                    <span className='text-[9px] font-medium text-primary'>{t.ch}</span>
                    <p
                      className={`text-[10px] mt-0.5 ${t.done ? 'line-through text-muted-foreground' : 'text-foreground/90'}`}
                    >
                      {t.msg}
                    </p>
                  </div>
                  {i === 0 && (
                    <Ring show>
                      <CheckCircle2 size={14} className='text-emerald-500' />
                    </Ring>
                  )}
                </div>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

function searchScenes(): SceneConfig[] {
  return [
    // Step 0: Cmd+K shortcut hint
    {
      cx: 50,
      cy: 50,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex items-center justify-center h-full p-4'>
            <Ring show>
              <div className='bg-card border border-border rounded-xl shadow-lg p-3 w-[160px]'>
                <div className='flex items-center gap-1.5 mb-2'>
                  <Search size={11} className='text-muted-foreground' />
                  <span className='text-[10px] text-muted-foreground flex-1'>
                    Search anything...
                  </span>
                  <kbd className='text-[8px] bg-muted rounded px-1 border border-border text-muted-foreground'>
                    ⌘K
                  </kbd>
                </div>
                <div className='space-y-0.5 text-[9px] text-muted-foreground'>
                  <div className='flex items-center gap-1 p-0.5 rounded hover:bg-muted/60'>
                    <Hash size={9} /> Channels
                  </div>
                  <div className='flex items-center gap-1 p-0.5 rounded hover:bg-muted/60'>
                    <Ticket size={9} /> Tickets
                  </div>
                </div>
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 1: Typing query
    {
      cx: 50,
      cy: 40,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex items-center justify-center h-full p-3'>
            <div className='bg-card border border-border rounded-xl shadow-lg p-3 w-[175px]'>
              <Ring show>
                <div className='flex items-center gap-1.5 rounded-lg border border-primary/50 bg-background px-2 py-1 mb-2'>
                  <Search size={10} className='text-primary' />
                  <span className='text-[10px] text-foreground flex-1'>
                    <Typing text='API timeout' />
                  </span>
                </div>
              </Ring>
              <Appear delay={0.6}>
                <div className='space-y-0.5'>
                  {['Message', 'Ticket', 'Person'].map((t, i) => (
                    <div
                      key={t}
                      className={`flex items-center gap-1.5 p-1 rounded text-[9px] ${i === 0 ? 'bg-muted/50' : ''}`}
                    >
                      <span className='text-muted-foreground w-10'>{t}</span>
                      <span className='text-foreground/80 truncate'>
                        {['#incidents', '#1024', 'Alice C.'][i]}
                      </span>
                    </div>
                  ))}
                </div>
              </Appear>
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 2: Navigate results
    {
      cx: 50,
      cy: 50,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex items-center justify-center h-full p-3'>
            <div className='bg-card border border-border rounded-xl shadow-lg p-3 w-[175px]'>
              <div className='flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 mb-2'>
                <Search size={10} className='text-muted-foreground' />
                <span className='text-[10px] text-muted-foreground'>API timeout</span>
              </div>
              <div className='space-y-0.5'>
                {[
                  { type: 'Message', text: '#incidents · "API timeout…"' },
                  { type: 'Ticket', text: '#1024 · Bug: API timeout' },
                  { type: 'Person', text: 'Alice Chen' },
                ].map((r, i) => (
                  <Ring key={r.type} show={i === 1}>
                    <div
                      className={`flex items-center gap-1.5 p-1 rounded text-[9px] ${i === 1 ? 'bg-primary/5' : ''}`}
                    >
                      <span className='text-muted-foreground w-10'>{r.type}</span>
                      <span className='text-foreground/80 truncate'>{r.text}</span>
                    </div>
                  </Ring>
                ))}
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 3: # channel search
    {
      cx: 50,
      cy: 40,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex items-center justify-center h-full p-3'>
            <div className='bg-card border border-border rounded-xl shadow-lg p-3 w-[175px]'>
              <Ring show>
                <div className='flex items-center gap-1.5 rounded-lg border border-primary/50 bg-background px-2 py-1 mb-2'>
                  <span className='text-primary font-bold text-[12px]'>#</span>
                  <span className='text-[10px] text-foreground flex-1'>
                    <Typing text='engineering' />
                  </span>
                </div>
              </Ring>
              <Appear delay={0.5}>
                <div className='space-y-0.5'>
                  {['#engineering', '#engineering-alerts', '#eng-infra'].map((ch, i) => (
                    <div
                      key={ch}
                      className={`flex items-center gap-1 p-1 rounded text-[9px] ${i === 0 ? 'bg-muted/50' : ''}`}
                    >
                      <Hash size={9} className='text-muted-foreground' />
                      <span className='text-foreground/80'>{ch.slice(1)}</span>
                    </div>
                  ))}
                </div>
              </Appear>
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 4: @ person search
    {
      cx: 50,
      cy: 40,
      el: (
        <AppShell sidebarActive='chat'>
          <div className='flex items-center justify-center h-full p-3'>
            <div className='bg-card border border-border rounded-xl shadow-lg p-3 w-[175px]'>
              <Ring show>
                <div className='flex items-center gap-1.5 rounded-lg border border-primary/50 bg-background px-2 py-1 mb-2'>
                  <span className='text-primary font-bold text-[12px]'>@</span>
                  <span className='text-[10px] text-foreground flex-1'>
                    <Typing text='Alice' />
                  </span>
                </div>
              </Ring>
              <Appear delay={0.5}>
                <div className='space-y-0.5'>
                  {[{ name: 'Alice Chen', init: 'AC', color: 'bg-violet-500' }].map(p => (
                    <div
                      key={p.name}
                      className='flex items-center gap-1.5 p-1 rounded text-[9px] bg-muted/50'
                    >
                      <Av initials={p.init} color={p.color} />
                      <span className='text-foreground/80'>{p.name}</span>
                    </div>
                  ))}
                </div>
              </Appear>
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

function ticketScenes(): SceneConfig[] {
  return [
    // Step 0: Tickets sidebar
    {
      cx: 4,
      cy: 38,
      el: (
        <AppShell sidebarActive='tickets' sidebarHighlight='tickets'>
          <div className='p-2 h-full flex items-center justify-center'>
            <p className='text-[10px] text-muted-foreground'>Click Tickets in the sidebar</p>
          </div>
        </AppShell>
      ),
    },
    // Step 1: New ticket button
    {
      cx: 88,
      cy: 12,
      el: (
        <AppShell sidebarActive='tickets'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center justify-between'>
              <span className='text-[11px] font-semibold text-foreground'>Tickets</span>
              <Ring show>
                <button
                  type='button'
                  className='flex items-center gap-0.5 bg-primary text-primary-foreground text-[9px] font-medium px-1.5 py-0.5 rounded'
                >
                  <Plus size={9} />
                  New
                </button>
              </Ring>
            </div>
            <div className='p-1.5 space-y-1'>
              {[
                '#1024 · API timeout on checkout',
                '#1023 · Dark mode toggle',
                '#1022 · Docs update',
              ].map((t, i) => (
                <div
                  key={i}
                  className='flex items-center gap-2 p-1 rounded border border-border/60 text-[9px]'
                >
                  <span className='text-muted-foreground font-mono'>{t.split('·')[0]}</span>
                  <span className='text-foreground/80 truncate flex-1'>{t.split('·')[1]}</span>
                </div>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 2: Fill title
    {
      cx: 55,
      cy: 42,
      el: (
        <AppShell sidebarActive='tickets'>
          <div className='p-2 space-y-1.5 h-full'>
            <p className='text-[10px] font-semibold text-foreground'>New Ticket</p>
            <Ring show>
              <div className='rounded border border-primary/50 bg-card px-2 py-1'>
                <p className='text-[9px] text-muted-foreground mb-0.5'>Title</p>
                <span className='text-[10px] text-foreground'>
                  <Typing text='Bug: API timeout on checkout' />
                </span>
              </div>
            </Ring>
            <div className='rounded border border-border/60 bg-card px-2 py-1'>
              <p className='text-[9px] text-muted-foreground mb-0.5'>Description</p>
              <p className='text-[9px] text-muted-foreground'>Add details...</p>
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 3: Assign to teammate
    {
      cx: 55,
      cy: 58,
      el: (
        <AppShell sidebarActive='tickets'>
          <div className='p-2 space-y-1.5 h-full'>
            <p className='text-[10px] font-semibold text-foreground'>New Ticket</p>
            <div className='rounded border border-border/60 bg-card px-2 py-1'>
              <p className='text-[9px] text-muted-foreground'>
                Title: Bug: API timeout on checkout
              </p>
            </div>
            <Ring show>
              <div className='rounded border border-primary/50 bg-card px-2 py-1.5'>
                <p className='text-[9px] text-muted-foreground mb-1'>Assignee</p>
                <div className='flex items-center gap-1.5'>
                  <Av initials='AC' color='bg-violet-500' />
                  <span className='text-[10px] font-medium text-foreground'>Alice Chen</span>
                </div>
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 4: Set priority
    {
      cx: 55,
      cy: 68,
      el: (
        <AppShell sidebarActive='tickets'>
          <div className='p-2 space-y-1 h-full'>
            <p className='text-[10px] font-semibold text-foreground'>New Ticket</p>
            <div className='rounded border border-border/60 px-2 py-1 text-[9px] text-muted-foreground'>
              Bug: API timeout on checkout
            </div>
            <div className='rounded border border-border/60 px-2 py-1 flex items-center gap-1'>
              <Av initials='AC' color='bg-violet-500' />
              <span className='text-[9px]'>Alice Chen</span>
            </div>
            <Ring show>
              <div className='rounded border border-primary/50 bg-card px-2 py-1.5'>
                <p className='text-[9px] text-muted-foreground mb-1'>Priority</p>
                <div className='flex gap-1'>
                  {['Low', 'Med', 'High', 'Critical'].map(p => (
                    <span
                      key={p}
                      className={`text-[8px] px-1.5 py-0.5 rounded-full border ${p === 'High' ? 'bg-rose-500/15 text-rose-600 border-rose-300' : 'bg-muted border-border text-muted-foreground'}`}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 5: Saved ticket
    {
      cx: 55,
      cy: 60,
      el: (
        <AppShell sidebarActive='tickets'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1.5'>
              <span className='text-[10px] font-semibold text-foreground'>Ticket #1024</span>
              <Ring show>
                <span className='text-[9px] bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded-full font-medium'>
                  Open
                </span>
              </Ring>
            </div>
            <div className='p-2 space-y-1'>
              <p className='text-[11px] font-medium text-foreground'>
                Bug: API timeout on checkout
              </p>
              <div className='flex items-center gap-1.5'>
                <Av initials='AC' color='bg-violet-500' />
                <span className='text-[9px] text-muted-foreground'>Assigned to Alice Chen</span>
              </div>
              <div className='flex gap-1 mt-1'>
                {['Open', 'In Review', 'Resolved'].map((s, i) => (
                  <span
                    key={s}
                    className={`text-[8px] px-1.5 py-0.5 rounded-full border ${i === 0 ? 'bg-amber-500/15 text-amber-600 border-amber-300 ring-1 ring-primary' : 'bg-muted border-border text-muted-foreground'}`}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

function xyneAiScenes(): SceneConfig[] {
  return [
    // Step 0: AI icon
    {
      cx: 90,
      cy: 8,
      el: (
        <AppShell sidebarActive='ai'>
          <div className='relative h-full'>
            <div className='p-2 text-[10px] text-muted-foreground'>Any screen in Xyne Spaces</div>
            <Ring show>
              <div className='absolute top-1 right-1 h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center'>
                <WandSparkles size={12} />
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 1: AI panel open, input
    {
      cx: 72,
      cy: 82,
      el: (
        <AppShell sidebarActive='ai'>
          <div className='flex flex-col h-full border-l border-border'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1'>
              <WandSparkles size={10} className='text-primary' />
              <span className='text-[10px] font-semibold text-foreground'>Xyne AI</span>
            </div>
            <div className='flex-1 p-2 flex items-center justify-center'>
              <p className='text-[9px] text-muted-foreground text-center'>
                Ask me anything about your workspace
              </p>
            </div>
            <Ring show>
              <div className='mx-2 mb-2 rounded-lg border border-primary/40 bg-card px-2 py-1'>
                <span className='text-[10px] text-foreground/70'>
                  <Typing text='Summarize #incidents today' />
                </span>
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 2: AI thinking
    {
      cx: 55,
      cy: 55,
      el: (
        <AppShell sidebarActive='ai'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 flex items-center gap-1'>
              <WandSparkles size={10} className='text-primary' />
              <span className='text-[10px] font-semibold text-foreground'>Xyne AI</span>
            </div>
            <div className='flex-1 p-2 space-y-1.5'>
              <div className='flex items-start gap-1.5 bg-muted/30 rounded-lg p-1.5'>
                <span className='text-[9px] text-muted-foreground font-medium'>You:</span>
                <p className='text-[9px] text-foreground/80'>Summarize #incidents today</p>
              </div>
              <div className='flex items-start gap-1.5'>
                <WandSparkles size={10} className='text-primary shrink-0 mt-0.5' />
                <Ring show>
                  <div className='rounded-lg bg-primary/5 border border-primary/20 p-1.5'>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 1.5, ease: 'easeInOut' }}
                      className='h-1.5 rounded-full bg-primary/30 mb-1'
                    />
                    <Appear>
                      <p className='text-[9px] text-foreground/90 leading-relaxed'>
                        1 incident today: API timeout (#1024). Alice fixed at 09:14, Bob confirmed
                        at 09:32.
                      </p>
                    </Appear>
                  </div>
                </Ring>
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
    // Step 3: Follow-up question
    {
      cx: 72,
      cy: 82,
      el: (
        <AppShell sidebarActive='ai'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground flex items-center gap-1'>
              <WandSparkles size={10} className='text-primary' /> Xyne AI
            </div>
            <div className='flex-1 p-2 space-y-1.5 overflow-hidden'>
              <div className='flex gap-1 bg-muted/30 rounded-lg p-1.5'>
                <span className='text-[9px] text-muted-foreground'>You:</span>
                <p className='text-[9px] text-foreground/80'>Who is working on it?</p>
              </div>
              <Appear>
                <div className='flex gap-1.5'>
                  <WandSparkles size={10} className='text-primary shrink-0 mt-0.5' />
                  <div className='bg-primary/5 border border-primary/20 rounded-lg p-1.5 flex-1'>
                    <p className='text-[9px] text-foreground/90'>
                      Alice Chen is the primary assignee. Bob Kumar is monitoring.
                    </p>
                  </div>
                </div>
              </Appear>
            </div>
            <Ring show>
              <div className='mx-2 mb-2 rounded-lg border border-primary/40 bg-card px-2 py-0.5'>
                <span className='text-[10px] text-muted-foreground'>
                  <Typing text='Ask a follow-up...' />
                </span>
              </div>
            </Ring>
          </div>
        </AppShell>
      ),
    },
    // Step 4: Share output
    {
      cx: 72,
      cy: 75,
      el: (
        <AppShell sidebarActive='ai'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground flex items-center gap-1'>
              <WandSparkles size={10} className='text-primary' /> Xyne AI
            </div>
            <div className='flex-1 p-2'>
              <div className='flex gap-1.5'>
                <WandSparkles size={10} className='text-primary shrink-0 mt-0.5' />
                <div className='bg-primary/5 border border-primary/20 rounded-lg p-1.5 flex-1'>
                  <p className='text-[9px] text-foreground/90 mb-1.5'>
                    Alice Chen fixed the API timeout. RCA in progress.
                  </p>
                  <div className='flex gap-1'>
                    <Ring show>
                      <button
                        type='button'
                        className='text-[8px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-medium'
                      >
                        Post to channel
                      </button>
                    </Ring>
                    <button
                      type='button'
                      className='text-[8px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded'
                    >
                      Add to Canvas
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

function callsScenes(): SceneConfig[] {
  return [
    {
      cx: 4,
      cy: 50,
      el: (
        <AppShell sidebarActive='calls' sidebarHighlight='calls'>
          <div className='p-2 h-full flex items-center justify-center'>
            <p className='text-[10px] text-muted-foreground'>Click Calls in the sidebar</p>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 55,
      cy: 45,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Calls
            </div>
            <div className='p-1.5 space-y-1'>
              {[
                { title: 'Daily Standup', p: 'AC, BK, MR', d: '18 min', active: false },
                { title: 'Product Review', p: 'AC, +4', d: '42 min', active: false },
                { title: 'Incident Bridge', p: 'BK, MR', d: 'Active', active: true },
              ].map((c, i) => (
                <Ring key={c.title} show={i === 0}>
                  <div
                    className={`flex items-center gap-1.5 p-1.5 rounded border border-border/60 ${i === 0 ? 'bg-muted/30' : ''}`}
                  >
                    <div
                      className={`h-6 w-6 rounded-md flex items-center justify-center ${c.active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'}`}
                    >
                      <Phone size={10} />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <p className='text-[10px] font-medium text-foreground'>{c.title}</p>
                      <span className='text-[9px] text-muted-foreground'>
                        {c.p} · {c.d}
                      </span>
                    </div>
                    {c.active && (
                      <span className='text-[8px] font-bold text-emerald-600 bg-emerald-500/15 px-1 py-0.5 rounded-full'>
                        LIVE
                      </span>
                    )}
                  </div>
                </Ring>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 80,
      cy: 55,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Calls
            </div>
            <div className='p-1.5 space-y-1'>
              <div className='flex items-center gap-1.5 p-1.5 rounded border border-emerald-500/30 bg-emerald-500/5'>
                <div className='h-6 w-6 rounded-md bg-emerald-500/15 text-emerald-600 flex items-center justify-center'>
                  <Phone size={10} />
                </div>
                <div className='flex-1'>
                  <p className='text-[10px] font-medium text-foreground'>Incident Bridge</p>
                  <span className='text-[9px] text-muted-foreground'>BK, MR · Active</span>
                </div>
                <Ring show>
                  <button
                    type='button'
                    className='text-[8px] bg-emerald-500 text-white px-2 py-0.5 rounded font-medium'
                  >
                    Join
                  </button>
                </Ring>
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 55,
      cy: 55,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground flex items-center justify-between'>
              <span>Daily Standup</span>
            </div>
            <div className='p-2 space-y-1.5'>
              <div className='grid grid-cols-2 gap-1 text-[9px] text-muted-foreground'>
                <div className='rounded bg-muted/40 p-1'>
                  <p className='text-muted-foreground'>Participants</p>
                  <div className='flex gap-0.5 mt-0.5'>
                    <Av initials='AC' color='bg-violet-500' />
                    <Av initials='BK' color='bg-sky-500' />
                    <Av initials='MR' color='bg-rose-500' />
                  </div>
                </div>
                <div className='rounded bg-muted/40 p-1'>
                  <p className='text-muted-foreground'>Duration</p>
                  <p className='text-foreground font-medium'>18 min</p>
                </div>
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 80,
      cy: 12,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground flex items-center justify-between'>
              <span>Calls</span>
              <Ring show>
                <button
                  type='button'
                  className='flex items-center gap-0.5 bg-primary text-primary-foreground text-[9px] px-1.5 py-0.5 rounded font-medium'
                >
                  <Plus size={8} /> New Call
                </button>
              </Ring>
            </div>
            <div className='p-2'>
              <Appear>
                <div className='rounded-lg border border-border/60 p-1.5 space-y-1'>
                  <p className='text-[10px] font-medium text-foreground'>New Call</p>
                  <div className='rounded border border-border/60 px-1.5 py-1'>
                    <span className='text-[9px] text-muted-foreground'>
                      Paste or generate meeting link
                    </span>
                  </div>
                </div>
              </Appear>
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

function recordingsScenes(): SceneConfig[] {
  return [
    {
      cx: 4,
      cy: 60,
      el: (
        <AppShell sidebarActive='calls' sidebarHighlight='calls'>
          <div className='p-2 h-full flex items-center justify-center'>
            <p className='text-[10px] text-muted-foreground text-center'>
              Click Recordings in the sidebar
            </p>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 55,
      cy: 45,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Recordings
            </div>
            <div className='p-1.5 space-y-1'>
              {[
                { title: 'Product Review · Apr 22', dur: '42:17' },
                { title: 'Daily Standup · Apr 23', dur: '18:04' },
              ].map((r, i) => (
                <Ring key={r.title} show={i === 0}>
                  <div
                    className={`flex items-center gap-1.5 p-1.5 rounded border border-border/60 ${i === 0 ? 'bg-muted/30' : ''}`}
                  >
                    <div className='h-6 w-6 rounded-md bg-primary/10 text-primary flex items-center justify-center'>
                      <Mic size={10} />
                    </div>
                    <div className='flex-1'>
                      <p className='text-[10px] font-medium text-foreground'>{r.title}</p>
                      <span className='text-[9px] text-muted-foreground'>{r.dur}</span>
                    </div>
                  </div>
                </Ring>
              ))}
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 55,
      cy: 65,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Product Review · Apr 22
            </div>
            <div className='p-2 space-y-1.5'>
              <div className='rounded-lg bg-muted/30 p-1.5 flex items-center gap-2'>
                <div className='h-5 w-5 rounded-full bg-primary/20 text-primary flex items-center justify-center'>
                  ▶
                </div>
                <div className='flex-1'>
                  <div className='h-1.5 bg-border rounded-full'>
                    <div className='h-full w-[35%] bg-primary rounded-full' />
                  </div>
                </div>
                <span className='text-[9px] text-muted-foreground'>14:52 / 42:17</span>
              </div>
              <Ring show>
                <div className='rounded border border-primary/40 bg-card'>
                  <div className='flex items-center gap-1 px-1.5 py-0.5 border-b border-border/40'>
                    <Search size={9} className='text-muted-foreground' />
                    <span className='text-[9px] text-muted-foreground'>Search transcript...</span>
                  </div>
                  {[
                    '14:52 — Alice: "Let\'s ship the API migration"',
                    '15:01 — Bob: "Agreed, on it"',
                  ].map((t, i) => (
                    <p
                      key={i}
                      className='text-[9px] text-foreground/80 px-1.5 py-0.5 hover:bg-muted/40 cursor-pointer'
                    >
                      {t}
                    </p>
                  ))}
                </div>
              </Ring>
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 65,
      cy: 60,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Product Review · Apr 22
            </div>
            <div className='p-2 space-y-1.5'>
              <div className='rounded border border-primary/30 bg-primary/5 p-1.5 text-[9px]'>
                <p className='text-muted-foreground mb-0.5'>Highlighted section</p>
                <p className='text-foreground/90'>
                  &quot;Let&apos;s ship the API migration this Friday&quot;
                </p>
              </div>
              <Ring show>
                <button
                  type='button'
                  className='flex items-center gap-1 bg-primary text-primary-foreground text-[9px] px-2 py-0.5 rounded font-medium'
                >
                  Share <ChevronRight size={9} />
                </button>
              </Ring>
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      cx: 55,
      cy: 50,
      el: (
        <AppShell sidebarActive='calls'>
          <div className='flex flex-col h-full'>
            <div className='border-b border-border px-2 py-1 text-[10px] font-semibold text-foreground'>
              Product Review · Apr 22
            </div>
            <div className='p-2'>
              <div className='rounded border border-border/60 p-1.5 space-y-0.5'>
                <p className='text-[9px] font-medium text-foreground'>Related calls</p>
                {['Daily Standup · Apr 23', 'Product Review · Apr 15'].map((c, i) => (
                  <div key={c} className='flex items-center gap-1.5 py-0.5'>
                    <Ring show={i === 0}>
                      <span className='text-[9px] text-primary cursor-pointer'>{c}</span>
                    </Ring>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </AppShell>
      ),
    },
  ];
}

// ─── Generic animated scene for remaining features ────────────────────────────

function genericScenes(visualKey: string): SceneConfig[] {
  const sidebarMap: Record<string, string> = {
    activity: 'chat',
    bookmarks: 'chat',
    recap: 'chat',
    canvas: 'chat',
    scheduled: 'chat',
    'projects-board': 'tickets',
    'list-projects': 'tickets',
    insights: 'tickets',
    forms: 'tickets',
    support: 'tickets',
    workflows: 'tickets',
    jira: 'tickets',
    agents: 'ai',
    'knowledge-base': 'ai',
    memory: 'ai',
    'ai-onboarding': 'ai',
    'user-groups': 'analytics',
    'user-management': 'analytics',
    analytics: 'analytics',
    'analytics-dashboard': 'analytics',
    apps: 'apps',
    browser: 'apps',
    vscode: 'apps',
    rca: 'apps',
    shortcuts: 'chat',
    'call-recording-share': 'calls',
  };

  const contentMap: Record<string, { title: string; lines: string[]; icon: ReactElement }> = {
    activity: {
      title: 'Activity',
      icon: <Activity size={10} />,
      lines: [
        'Alice replied in #engineering',
        'Bob reacted to your message',
        '@you mentioned in #incidents',
      ],
    },
    bookmarks: {
      title: 'Bookmarks',
      icon: <BookOpen size={10} />,
      lines: ['Deploy checklist for v2.0', 'Q2 OKRs doc link', 'DB runbook — pool tuning'],
    },
    recap: {
      title: 'Recap',
      icon: <Sparkles size={10} />,
      lines: [
        '#engineering · API migration merged',
        '#product · Q2 roadmap approved',
        '#incidents · Outage resolved 03:47',
      ],
    },
    canvas: {
      title: 'Canvas',
      icon: <PanelsTopLeft size={10} />,
      lines: ['Q2 Product Roadmap (shared)', 'Engineering Handbook', 'Incident Runbook v3'],
    },
    scheduled: {
      title: 'Scheduled',
      icon: <CalendarClock size={10} />,
      lines: ['#general — Mon 9:00 AM', 'Alice Chen — Today 2:00 PM'],
    },
    'projects-board': {
      title: 'Projects Board',
      icon: <FolderKanban size={10} />,
      lines: [
        'To Do: Design login, Write docs',
        'In Progress: Dark mode, API v2',
        'Done: Auth refactor, Fix checkout',
      ],
    },
    'list-projects': {
      title: 'List Projects',
      icon: <SquareKanban size={10} />,
      lines: [
        'Mobile App v2.0 · AC · Active',
        'Platform Migration · BK · On Hold',
        'Design System · MR · Active',
      ],
    },
    insights: {
      title: 'Insights',
      icon: <Lightbulb size={10} />,
      lines: ['Messages: 2,340 (+12%)', 'Resolved tickets: 87 (+5%)', 'Call hours: 14h (−2%)'],
    },
    forms: {
      title: 'Forms',
      icon: <FileText size={10} />,
      lines: [
        'Bug Report — 12 responses',
        'Feature Request — 5 responses',
        'Onboarding Survey — 31 responses',
      ],
    },
    support: {
      title: 'Support',
      icon: <Headphones size={10} />,
      lines: [
        'SRT-042 · Cannot log in · 2h left ⚠',
        'SRT-041 · Export CSV broken · 5h',
        'SRT-040 · Notification delay',
      ],
    },
    workflows: {
      title: 'Workflows',
      icon: <Workflow size={10} />,
      lines: [
        '✅ Assign to on-call',
        '✅ Notify #incidents',
        '⟳ Create RCA draft (running)',
        '○ Close linked alerts',
      ],
    },
    jira: {
      title: 'Jira Migration',
      icon: <ArrowRightLeft size={10} />,
      lines: [
        'Project: PROJ · Platform Eng',
        '340 / 500 tickets imported (68%)',
        'Errors: 2 · Fields mapped: 12/14',
      ],
    },
    agents: {
      title: 'Agents',
      icon: <Bot size={10} />,
      lines: ['Support Bot — Active ●', 'Code Review Agent — Active ●', 'Standup Bot — Inactive ○'],
    },
    'knowledge-base': {
      title: 'Knowledge Base',
      icon: <BookOpen size={10} />,
      lines: [
        'API Documentation — Engineering',
        'Onboarding Guide — HR',
        'Engineering Runbook — Ops',
      ],
    },
    memory: {
      title: 'Context Memory',
      icon: <Brain size={10} />,
      lines: [
        'Platform migration: use Postgres',
        'On-call: Alice leads P0',
        'Deploys: Tue & Thu 14:00 UTC',
      ],
    },
    'ai-onboarding': {
      title: 'AI Onboarding',
      icon: <Sparkles size={10} />,
      lines: [
        '✅ Connect tools (GitHub, Drive)',
        '✅ Add team members',
        '○ Review suggested memories',
      ],
    },
    'user-groups': {
      title: 'User Groups',
      icon: <Users size={10} />,
      lines: ['Engineering — 8 members', 'Customer Success — 5 members', 'Leadership — 3 members'],
    },
    'user-management': {
      title: 'User Management',
      icon: <ShieldUser size={10} />,
      lines: ['Alice Chen — Admin', 'Bob Kumar — Member', 'Maya Rao — Read-only'],
    },
    analytics: {
      title: 'Analytics',
      icon: <BarChart3 size={10} />,
      lines: [
        'Messages sent: 2,340 (+12%)',
        'Tickets resolved: 87 (+5%)',
        'Call duration: 14h total',
      ],
    },
    'analytics-dashboard': {
      title: 'Dashboards',
      icon: <PieChart size={10} />,
      lines: ['Weekly Engineering Health', 'Tickets by Assignee', 'Resolution Time trend'],
    },
    apps: {
      title: 'Apps',
      icon: <AppWindow size={10} />,
      lines: ['GitHub — Connected ✓', 'Google Drive — Connected ✓', 'PagerDuty — Not connected'],
    },
    browser: {
      title: 'Browser Panel',
      icon: <Globe size={10} />,
      lines: ['docs.github.com/en/pull-requests', 'grafana.example.com/dashboard', 'New tab (+)'],
    },
    vscode: {
      title: 'VSCode Workspace',
      icon: <FileCode2 size={10} />,
      lines: ['src/auth.ts', 'src/api.ts', 'tests/auth.test.ts'],
    },
    rca: {
      title: 'RCA',
      icon: <ClipboardCheck size={10} />,
      lines: [
        'API Outage · Apr 22 02:14 UTC',
        'Root Cause: Connection pool limit',
        'Action: Alice — Add pool limit cap',
      ],
    },
    shortcuts: {
      title: 'Shortcuts',
      icon: <Wrench size={10} />,
      lines: ['⌘K — Global Search', '⌘⇧M — New Direct Message', '? — Open shortcuts modal'],
    },
    'call-recording-share': {
      title: 'Call Context',
      icon: <FileAudio2 size={10} />,
      lines: ['Product Review · Apr 22 · 42:17', 'Transcript: searchable', 'Share highlight clip'],
    },
  };

  const cfg = contentMap[visualKey] ?? {
    title: visualKey,
    icon: <Sparkles size={10} />,
    lines: ['Feature preview', 'Step by step guide', 'Follow the steps below'],
  };
  const sb = sidebarMap[visualKey] ?? 'chat';

  const scenes: SceneConfig[] = cfg.lines.map((_line, i) => ({
    cx: 75,
    cy: 28 + i * 25,
    el: (
      <AppShell sidebarActive={sb}>
        <div className='flex flex-col h-full'>
          <div className='border-b border-border px-2 py-1 flex items-center gap-1'>
            <span className='text-primary'>{cfg.icon}</span>
            <span className='text-[10px] font-semibold text-foreground'>{cfg.title}</span>
          </div>
          <div className='p-1.5 space-y-0.5 flex-1'>
            {cfg.lines.map((l, j) => (
              <Ring key={j} show={j === i}>
                <div
                  className={`flex items-start gap-1.5 p-1.5 rounded text-[10px] ${j === i ? 'bg-primary/5' : ''}`}
                >
                  {j < i ? (
                    <CheckCircle2 size={11} className='text-emerald-500 shrink-0 mt-0.5' />
                  ) : j === i ? (
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                      className='h-2.5 w-2.5 rounded-full bg-primary shrink-0 mt-0.5'
                    />
                  ) : (
                    <Circle size={11} className='text-muted-foreground/30 shrink-0 mt-0.5' />
                  )}
                  <span
                    className={
                      j === i
                        ? 'text-foreground font-medium'
                        : j < i
                          ? 'text-muted-foreground line-through'
                          : 'text-muted-foreground/60'
                    }
                  >
                    {l}
                  </span>
                </div>
              </Ring>
            ))}
          </div>
        </div>
      </AppShell>
    ),
  }));

  return scenes;
}

// ─── Scene dispatcher ─────────────────────────────────────────────────────────

function getScenesForKey(key: string, _title: string): SceneConfig[] {
  switch (key) {
    case 'chat':
      return chatScenes();
    case 'dms':
      return dmScenes();
    case 'threads':
      return threadsScenes();
    case 'search':
      return searchScenes();
    case 'tickets':
      return ticketScenes();
    case 'xyne-ai':
      return xyneAiScenes();
    case 'calls':
      return callsScenes();
    case 'recordings':
      return recordingsScenes();
    default:
      return genericScenes(key);
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export const FeatureDemo = ({ visualKey, currentStep, title }: FeatureDemoProps): ReactElement => {
  const scenes = useMemo(() => getScenesForKey(visualKey, title), [visualKey, title]);
  const idx = Math.min(currentStep, scenes.length - 1);
  const { el, cx, cy } = scenes[idx]!;

  return (
    <div className='rounded-xl border border-border bg-background overflow-hidden shadow-sm'>
      {/* Browser chrome */}
      <div className='h-7 bg-muted/60 border-b border-border flex items-center px-2.5 gap-1.5 shrink-0'>
        <span className='h-2 w-2 rounded-full bg-destructive/60' />
        <span className='h-2 w-2 rounded-full bg-amber-400/70' />
        <span className='h-2 w-2 rounded-full bg-emerald-500/60' />
        <span className='flex-1 text-center text-[10px] text-muted-foreground font-medium'>
          Xyne Spaces
        </span>
      </div>

      {/* Scene area */}
      <div className='relative overflow-hidden' style={{ minHeight: 164 }}>
        <AnimatePresence mode='wait'>
          <motion.div
            key={`${visualKey}-${idx}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {el}
          </motion.div>
        </AnimatePresence>

        {/* Animated cursor */}
        <Cursor x={cx} y={cy} />
      </div>
    </div>
  );
};
