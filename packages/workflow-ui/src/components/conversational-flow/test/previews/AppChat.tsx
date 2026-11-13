/**
 * Support inside the merchant's own app — the same chat on the web, on iOS and
 * on Android.
 *
 * One conversation design: the agent's avatar and name on the first bubble of a
 * group, the merchant's brand (`--wui-primary`) on the person's bubbles and the
 * send button, suggestions above the composer, a day divider, "Delivered".
 *
 * Only the chrome differs, because only the chrome differs in real apps: a
 * navigation bar on iOS, a top app bar on Android, a widget header on the web.
 * That is what `CHROME` below holds — nothing about the conversation itself.
 *
 * WhatsApp is not here: it is somebody else's app, with its own rules.
 */
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUp, ChevronLeft, MoreHorizontal, MoreVertical, Paperclip, Search, Send } from 'lucide-react';
import { cn } from '../../../shared/cn.js';
import { AnswerForm } from './AnswerForm.js';
import { MessageText } from '../../../shared/MessageText.js';
import type { Chat } from './chat.js';
import { Caret, Dots, Empty, PhoneFrame, useClock } from './shell.js';

export type Platform = 'web' | 'ios' | 'android';

const BRAND = 'var(--wui-primary)';

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

interface Chrome {
  font: string;
  /** The conversation's background. */
  surface: string;
  /** An incoming bubble — the agent's. */
  bubbleIn: string;
  bubbleRadius: string;
  /** The person's own bubble; the brand fills it. */
  bubbleOutRadius: string;
  body: string;
  header: (chat: Chat) => ReactNode;
  composer: { field: string; send: string; sendIcon: ReactNode; attach: boolean };
  /** Phone previews carry a status bar and a home indicator; the web one doesn't. */
  phone?: { statusClass: string; indicatorClass: string };
}

const presence = (chat: Chat) => chat.activity ?? 'Online';

const CHROME: Record<Platform, Chrome> = {
  web: {
    font: SYSTEM_FONT,
    surface: 'bg-[#f8fafc]',
    bubbleIn: 'bg-white text-slate-800 border border-slate-200/70',
    bubbleRadius: 'rounded-[18px]',
    bubbleOutRadius: 'rounded-[18px]',
    body: 'text-[13.5px]',
    header: (chat) => (
      <header className="flex shrink-0 items-center gap-3 px-4 py-3 text-white" style={{ background: '#0f172a' }}>
        <Avatar size="h-8 w-8 text-[12.5px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">Support</span>
          <span className="flex items-center gap-1.5 text-[11px] text-white/65">
            {!chat.activity && <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" aria-hidden />}
            <span role={chat.activity ? 'status' : undefined} className="truncate">{presence(chat)}</span>
          </span>
        </span>
      </header>
    ),
    composer: {
      field: 'rounded-full bg-slate-100 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:bg-white',
      send: 'h-8 w-8 rounded-full',
      sendIcon: <Send className="h-[15px] w-[15px]" />,
      attach: false,
    },
  },
  ios: {
    font: SYSTEM_FONT,
    surface: 'bg-[#f2f2f7]',
    bubbleIn: 'bg-white text-black shadow-[0_1px_2px_rgba(0,0,0,0.06)]',
    bubbleRadius: 'rounded-[20px]',
    bubbleOutRadius: 'rounded-[20px]',
    body: 'text-[15px]',
    header: (chat) => (
      <header className="shrink-0 border-b border-black/[0.07] bg-white/95 backdrop-blur">
        <div className="flex items-center px-2.5 py-2">
          <span className="flex items-center gap-0.5 text-[15px]" style={{ color: BRAND }}>
            <ChevronLeft className="h-[18px] w-[18px]" aria-hidden />
            Help
          </span>
          <span className="mx-auto flex flex-col items-center">
            <span className="text-[16px] font-semibold text-black">Support</span>
            {chat.activity && <span role="status" className="max-w-[170px] truncate text-[10.5px] text-[#8e8e93]">{chat.activity}</span>}
          </span>
          <MoreHorizontal className="h-[18px] w-[18px] shrink-0" style={{ color: BRAND }} aria-hidden />
        </div>
      </header>
    ),
    composer: {
      field: 'rounded-full bg-[#f2f2f7] text-[15px] text-black placeholder:text-[#a1a1a6]',
      send: 'h-[30px] w-[30px] rounded-full',
      sendIcon: <ArrowUp className="h-[15px] w-[15px]" strokeWidth={2.6} />,
      attach: true,
    },
    phone: { statusClass: 'bg-white text-black', indicatorClass: 'bg-black/75' },
  },
  android: {
    font: 'Roboto, "Noto Sans", system-ui, sans-serif',
    surface: 'bg-[#fffbfe]',
    bubbleIn: 'bg-[#ece6f0] text-[#1d1b20]',
    bubbleRadius: 'rounded-[18px]',
    bubbleOutRadius: 'rounded-[18px]',
    body: 'text-[14.5px]',
    header: (chat) => (
      <header className="flex shrink-0 items-center gap-3 bg-[#fef7ff] px-3 py-2.5 text-[#1d1b20]">
        <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
        <Avatar size="h-8 w-8 text-[12.5px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">Support</span>
          <span role={chat.activity ? 'status' : undefined} className="block truncate text-[11.5px] text-[#49454f]">{presence(chat)}</span>
        </span>
        <Search className="h-[18px] w-[18px] shrink-0 text-[#49454f]" aria-hidden />
        <MoreVertical className="h-[18px] w-[18px] shrink-0 text-[#49454f]" aria-hidden />
      </header>
    ),
    composer: {
      field: 'rounded-full bg-[#ece6f0] text-[14.5px] text-[#1d1b20] placeholder:text-[#79747e]',
      send: 'h-10 w-10 rounded-[14px]',
      sendIcon: <Send className="h-4 w-4" />,
      attach: true,
    },
    phone: { statusClass: 'bg-[#fef7ff] text-[#1d1b20]', indicatorClass: 'bg-[#1d1b20]/60' },
  },
};

function Avatar({ size }: { size: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white', size)} style={{ background: BRAND }}>
      S
    </span>
  );
}

export function AppChat({ chat, platform }: { chat: Chat; platform: Platform }) {
  const c = CHROME[platform];
  const time = useClock();
  const spoken = chat.lines.filter((l) => l.from !== 'system');
  const lastIsPerson = spoken.length > 0 && spoken[spoken.length - 1]!.from === 'person';
  const muted = platform === 'web' ? 'text-slate-400' : platform === 'ios' ? 'text-[#8e8e93]' : 'text-[#79747e]';

  const conversation = (
    <>
      {c.header(chat)}

      <div className={cn('flex-1 overflow-y-auto px-3.5 py-3', c.surface)} style={{ fontFamily: c.font }}>
        {chat.run.state === 'idle' && chat.lines.length === 0 && <Empty className={muted} />}
        {chat.lines.length > 0 && (
          <p className={cn('pb-2 text-center text-[11px] font-medium uppercase tracking-[0.04em]', muted)}>Today</p>
        )}

        <div className="space-y-1.5">
          {chat.lines.map((line, i) => {
            if (line.from === 'system') {
              return <p key={i} className={cn('py-2 text-center text-[11.5px]', muted)}>{line.text}</p>;
            }
            if (line.from === 'person') {
              return (
                <div key={i} className="flex justify-end">
                  <div
                    className={cn('max-w-[76%] px-3.5 py-2 leading-[1.4] text-white', c.bubbleOutRadius, c.body)}
                    style={{ background: BRAND }}
                  >
                    <MessageText text={line.text} />
                  </div>
                </div>
              );
            }
            const previous = chat.lines[i - 1];
            const opensGroup = !previous || previous.from !== line.from;
            return (
              <div key={i} className={cn('flex items-end gap-2', opensGroup && i > 0 && 'pt-1.5')}>
                <span className={cn(!opensGroup && 'invisible')}>
                  <Avatar size="h-7 w-7 text-[11px]" />
                </span>
                <div className="min-w-0">
                  {opensGroup && <span className={cn('mb-1 block text-[11px] font-medium', muted)}>Support</span>}
                  <div className={cn('max-w-[260px] px-3.5 py-2 leading-[1.4]', c.bubbleIn, c.bubbleRadius, c.body)}>
                    <MessageText text={line.text} />
                  </div>
                </div>
              </div>
            );
          })}

          {chat.streaming && (
            <div className="flex items-end gap-2">
              <Avatar size="h-7 w-7 text-[11px]" />
              <div aria-live="polite" className={cn('max-w-[260px] px-3.5 py-2 leading-[1.4]', c.bubbleIn, c.bubbleRadius, c.body)}>
                <MessageText text={chat.streaming} />
                <Caret className="bg-current opacity-40" />
              </div>
            </div>
          )}

          {chat.activity && !chat.streaming && (
            <div className="flex items-end gap-2">
              <Avatar size="h-7 w-7 text-[11px]" />
              <span className={cn('px-4 py-3', c.bubbleIn, c.bubbleRadius)}>
                <Dots className="bg-current" />
              </span>
            </div>
          )}

          {spoken.length > 0 && !chat.activity && (
            <p className={cn('pt-0.5 text-[10.5px]', muted, lastIsPerson ? 'text-right' : 'pl-9')}>
              {lastIsPerson ? `Delivered · ${time}` : time}
            </p>
          )}
        </div>
        <div ref={chat.endRef} />
      </div>

      {/* What it asks for, above the quick replies: the form is the answer, and
          the replies are the ways out of it. */}
      {chat.asking && (
        <div className={cn('shrink-0 border-t border-black/[0.06] px-3 py-2.5', c.surface)} style={{ fontFamily: c.font }}>
          <AnswerForm
              fields={chat.fields}
              answer={chat.answer}
              onAnswer={chat.setAnswer}
              ways={chat.options}
              disabled={chat.activity !== null}
              {...(chat.canType ? {} : { onSend: { label: 'Send', can: chat.canGive, send: chat.give } })}
              onLeave={chat.choose}
            />
        </div>
      )}
      {/* Suggestions sit above the composer, the way in-app support chats show them. */}
      {!chat.asking && chat.options.length > 0 && (
        <div
          className={cn('shrink-0 border-t border-black/[0.06] px-3 py-2', c.surface, chat.handedOff ? 'max-h-28 overflow-y-auto' : 'overflow-x-auto')}
          style={{ fontFamily: c.font }}
        >
          <div className={cn('flex gap-2', chat.handedOff ? 'flex-wrap' : 'w-max')}>
            {chat.options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => chat.choose(o)}
                className="shrink-0 rounded-full border bg-white px-3.5 py-2 text-[13px] font-medium transition-opacity active:opacity-70"
                style={{ borderColor: 'color-mix(in srgb, var(--wui-primary) 35%, transparent)', color: BRAND }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        className="flex shrink-0 items-center gap-2 border-t border-black/[0.07] bg-white px-3 py-2"
        style={{ fontFamily: c.font }}
        onSubmit={(e) => {
          e.preventDefault();
          chat.send();
        }}
      >
        {c.composer.attach && <Paperclip className={cn('h-[18px] w-[18px] shrink-0', muted)} aria-hidden />}
        <label htmlFor="cf-test-input" className="sr-only">Reply as them</label>
        <input
          id="cf-test-input"
          value={chat.text}
          onChange={(e) => chat.setText(e.target.value)}
          disabled={!chat.canType}
          placeholder={chat.placeholder}
          className={cn('min-w-0 flex-1 px-3.5 py-2 outline-none disabled:opacity-60', c.composer.field)}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!chat.canSend}
          className={cn('grid shrink-0 place-items-center text-white transition-opacity disabled:opacity-30', c.composer.send)}
          style={{ background: BRAND }}
        >
          {c.composer.sendIcon}
        </button>
      </form>
    </>
  );

  if (!c.phone) {
    return (
      <div className="flex min-h-0 flex-1 items-stretch justify-center px-4 pb-4 pt-3">
        <div className="flex min-h-0 w-full max-w-[380px] flex-col overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.45)]">
          {conversation}
        </div>
      </div>
    );
  }
  return (
    <PhoneFrame statusClass={c.phone.statusClass} indicatorClass={c.phone.indicatorClass}>
      {conversation}
    </PhoneFrame>
  );
}
