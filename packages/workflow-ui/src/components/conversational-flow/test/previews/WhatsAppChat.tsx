/**
 * The conversation on WhatsApp — including the one thing that really changes
 * there: three replies are buttons, more become a list the person opens.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, MoreVertical, Paperclip, Phone, Send, Smile, Video } from 'lucide-react';
import { cn } from '../../../shared/cn.js';
import { AnswerForm } from './AnswerForm.js';
import { MessageText } from '../../../shared/MessageText.js';
import type { Chat } from './chat.js';
import { Caret, Dots, Empty, PhoneFrame, Ticks, useClock } from './shell.js';

const GREEN = '#008069';
const OUT = '#d9fdd3';
const LINK = '#027eb5';
/** WhatsApp shows at most three reply buttons; more have to be a list. */
const BUTTONS = 3;

export function WhatsAppChat({ chat }: { chat: Chat }) {
  const time = useClock();
  const asList = chat.options.length > BUTTONS;
  const [listOpen, setListOpen] = useState(false);
  const count = chat.lines.length;
  useEffect(() => setListOpen(false), [count]);

  return (
    <PhoneFrame statusClass="bg-[#008069] text-white" indicatorClass="bg-black/40">
      <header className="flex shrink-0 items-center gap-2.5 px-3 py-2 text-white" style={{ background: GREEN }}>
        <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/25 text-[12.5px] font-semibold">S</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-tight">Support</span>
          <span role={chat.activity ? 'status' : undefined} className="block truncate text-[11.5px] text-white/85">
            {chat.activity ?? 'online'}
          </span>
        </span>
        <Video className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <Phone className="h-[17px] w-[17px] shrink-0" aria-hidden />
        <MoreVertical className="h-[18px] w-[18px] shrink-0" aria-hidden />
      </header>

      <div
        className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3"
        style={{
          background: '#efe7de',
          backgroundImage:
            'radial-gradient(circle at 18% 28%, rgba(0,0,0,0.025) 0 2px, transparent 2px), radial-gradient(circle at 72% 62%, rgba(0,0,0,0.025) 0 2px, transparent 2px)',
          backgroundSize: '46px 46px',
        }}
      >
        {chat.run.state === 'idle' && chat.lines.length === 0 && <Empty className="text-[#667781]" />}

        {chat.lines.map((line, i) =>
          line.from === 'system' ? (
            <p key={i} className="py-1 text-center">
              <span className="rounded-md bg-[#ffeecd] px-2.5 py-1 text-[11px] text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">{line.text}</span>
            </p>
          ) : (
            <div key={i} className={cn('flex', line.from === 'person' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] px-2 py-[5px] text-[14.2px] leading-[1.4] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]',
                  line.from === 'person' ? 'rounded-[8px_2px_8px_8px]' : 'rounded-[2px_8px_8px_8px]',
                )}
                style={{ background: line.from === 'person' ? OUT : '#ffffff' }}
              >
                <MessageText text={line.text} />
                <span className="float-right ml-2 mt-[6px] flex items-center gap-1 text-[10.5px] leading-none text-[#667781]">
                  {time}
                  {line.from === 'person' && <Ticks />}
                </span>
              </div>
            </div>
          ),
        )}

        {chat.streaming && (
          <div className="flex justify-start">
            <div aria-live="polite" className="max-w-[80%] rounded-[2px_8px_8px_8px] bg-white px-2 py-[5px] text-[14.2px] leading-[1.4] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
              <MessageText text={chat.streaming} />
              <Caret className="bg-[#667781]" />
            </div>
          </div>
        )}

        {chat.activity && !chat.streaming && (
          <div className="flex justify-start">
            <span className="rounded-[2px_8px_8px_8px] bg-white px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
              <Dots className="bg-[#667781]" />
            </span>
          </div>
        )}

        {/* A form arrives as its own message here, the way a WhatsApp flow does. */}
        {chat.asking && (
          <div className="flex justify-start">
            <div className="w-[80%] rounded-[2px_8px_8px_8px] bg-white px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
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
          </div>
        )}
        {!chat.asking && chat.options.length > 0 && (
          <div className="flex justify-start">
            <div className="w-[80%] overflow-hidden rounded-[8px] bg-white shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
              {!asList &&
                chat.options.map((o, i) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => chat.choose(o)}
                    className={cn('block w-full truncate px-3 py-2.5 text-center text-[14px] font-medium active:bg-black/[0.03]', i > 0 && 'border-t border-[#e9edef]')}
                    style={{ color: LINK }}
                  >
                    {o.label}
                  </button>
                ))}

              {asList && !listOpen && (
                <button
                  type="button"
                  onClick={() => setListOpen(true)}
                  className="flex w-full items-center justify-center gap-2 px-3 py-2.5 text-[14px] font-medium active:bg-black/[0.03]"
                  style={{ color: LINK }}
                >
                  <Lines /> Choose an option
                </button>
              )}

              {asList && listOpen && (
                <div className="max-h-56 overflow-y-auto">
                  <p className="border-b border-[#e9edef] px-3 py-2 text-[12px] font-semibold text-[#111b21]">Choose an option</p>
                  {chat.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => chat.choose(o)}
                      className="flex w-full items-center gap-2 border-b border-[#f0f2f5] px-3 py-2.5 text-left text-[14px] text-[#111b21] last:border-b-0 active:bg-black/[0.03]"
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[#8696a0]" aria-hidden />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={chat.endRef} />
      </div>

      <form
        className="flex shrink-0 items-center gap-1.5 bg-[#f0f2f5] px-2 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          chat.send();
        }}
      >
        <label htmlFor="cf-test-input" className="sr-only">Reply as them</label>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[20px] bg-white px-3 py-[7px]">
          <Smile className="h-[18px] w-[18px] shrink-0 text-[#8696a0]" aria-hidden />
          <input
            id="cf-test-input"
            value={chat.text}
            onChange={(e) => chat.setText(e.target.value)}
            disabled={!chat.canType}
            placeholder={chat.placeholder}
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-[#111b21] outline-none placeholder:text-[#8696a0] disabled:opacity-60"
          />
          <Paperclip className="h-[18px] w-[18px] shrink-0 text-[#8696a0]" aria-hidden />
        </div>
        <button
          type="submit"
          aria-label="Send"
          disabled={!chat.canSend}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white disabled:opacity-40"
          style={{ background: GREEN }}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </PhoneFrame>
  );
}

const Lines = () => (
  <svg width="15" height="12" viewBox="0 0 15 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <path d="M1 1.6h13M1 6h13M1 10.4h13" />
  </svg>
);
