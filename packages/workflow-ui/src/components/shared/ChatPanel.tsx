import { useCallback, useEffect, useRef } from 'react';
import type { AiBuilderMessage } from '@xyne/workflow-sdk/ai-builder';
import type { StreamingState } from './chat-types.js';
import { cn } from './cn.js';

// Friendly label for a tool name (run_code → "code"); fallback prettifies.
const TOOL_LABELS: Record<string, string> = { run_code: 'code' };
const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name.replace(/_/g, ' ');

/** Compact tool-call chip: ⚙ Running/Ran <label> + spinner/✓/✗. */
function ToolChip({ tool }: { tool: { name: string; done: boolean; isError?: boolean | undefined } }) {
  const label = toolLabel(tool.name);
  const text = tool.done ? (tool.isError ? `${label} failed` : `Ran ${label}`) : `Running ${label}…`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium',
        tool.isError
          ? 'border-[var(--wui-status-failed)] bg-[color-mix(in_srgb,var(--wui-status-failed)_10%,transparent)] text-[var(--wui-status-failed)]'
          : 'border-[var(--wui-border)] bg-[var(--wui-bg)] text-[var(--wui-fg-muted)]',
      )}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn(!tool.done && 'animate-spin')}>
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      {text}
      {tool.done && !tool.isError && (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--wui-status-completed)]"><polyline points="20 6 9 17 4 12" /></svg>
      )}
    </span>
  );
}

/**
 * Renders only the MOST RECENT tool chip (+ a "+N" count of any earlier ones) —
 * a long run_code sequence shows just the current "Running / Ran code," not an
 * ever-growing list of chips.
 */
function ToolChipStrip({ tools }: { tools: Array<{ name: string; done: boolean; isError?: boolean | undefined }> }) {
  if (tools.length === 0) return null;
  const last = tools[tools.length - 1]!;
  const extra = tools.length - 1;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ToolChip tool={{ name: last.name, done: last.done, ...(last.isError ? { isError: true } : {}) }} />
      {extra > 0 && (
        <span className="text-[10px] font-medium text-[var(--wui-fg-muted)]">+{extra}</span>
      )}
    </div>
  );
}

/** The three-dot "typing" indicator. */
function TypingDots() {
  return (
    <div className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--wui-fg-muted)] animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--wui-fg-muted)] animate-bounce [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--wui-fg-muted)] animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

// Renders a single line of markdown-lite: **bold**, `code`, plain text
function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
          return <code key={i} className="rounded bg-black/10 px-1 font-mono text-[11px]">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// Renders markdown text: splits on newlines, handles --- dividers
function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        if (/^-{3,}$/.test(line.trim()))
          return <hr key={i} className="my-1.5 border-[var(--wui-border)]" />;
        return (
          <p key={i} className={line === '' ? 'h-2' : undefined}>
            <InlineMd text={line} />
          </p>
        );
      })}
    </div>
  );
}

export interface SharedChatPanelProps {
  isOpen: boolean;
  messages: AiBuilderMessage[];
  isLoading: boolean;
  /** Live assistant turn while streaming (text snapshot + tool chips). */
  streaming?: StreamingState | null;
  error: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
  /** Abort the in-flight streaming turn (Send button becomes Stop). */
  onStop?: () => void;
  onReset: () => void;
  onClose: () => void;
  suggestions: string[];
  emptyStateDescription: string;
  placeholder?: string;
  canSend: boolean;
  bannerSlot?: React.ReactNode;
  inputPrefixSlot?: React.ReactNode;
  containerStyle?: React.CSSProperties;
  containerClassName?: string;
  /** Optional drag handle rendered at the panel's left edge (for resizing). */
  resizeHandle?: React.ReactNode;
}

export function SharedChatPanel({
  isOpen,
  messages,
  isLoading,
  streaming,
  error,
  draft,
  onDraftChange,
  onSend,
  onStop,
  onReset,
  onClose,
  suggestions,
  emptyStateDescription,
  placeholder = 'Ask anything…',
  canSend,
  bannerSlot,
  inputPrefixSlot,
  containerStyle,
  containerClassName,
  resizeHandle,
}: SharedChatPanelProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the chat pinned to the bottom by scrolling the messages CONTAINER only
  // — never `scrollIntoView`, which also scrolls scrollable ancestors (the whole
  // page) and fires on every streaming snapshot.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => textareaRef.current?.focus(), 180);
    return () => clearTimeout(id);
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void onSend();
      }
    },
    [onSend],
  );

  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-col border-l border-[var(--wui-border)] bg-[var(--wui-bg)] overflow-hidden',
        containerClassName,
      )}
      style={containerStyle}
    >
      {isOpen && (
        <>
          {resizeHandle}
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--wui-border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] text-[var(--wui-primary)]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span className="text-[13px] font-semibold text-[var(--wui-fg)]">Ask AI</span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={onReset}
                  title="Clear conversation"
                  className="flex h-6 w-6 items-center justify-center rounded text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                title="Close"
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Banner slot (saving indicator, form fill banner, etc.) */}
          {bannerSlot}

          {/* Messages */}
          <div ref={messagesRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--wui-primary)_10%,transparent)] text-[var(--wui-primary)]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                <p className="max-w-[220px] text-[12px] text-[var(--wui-fg-muted)]">
                  {emptyStateDescription}
                </p>
                {suggestions.length > 0 && (
                  <div className="flex w-full flex-col gap-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => onDraftChange(s)}
                        className="rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-3 py-2 text-left text-[11px] text-[var(--wui-fg-muted)] transition hover:bg-[color-mix(in_srgb,var(--wui-primary)_8%,transparent)] hover:border-[var(--wui-primary)] hover:text-[var(--wui-primary)]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((msg, i) => {
              // Strip embedded <document> XML so filenames show as chips, not raw text
              const docNames: string[] = [];
              const visibleText = msg.content
                .replace(/<document name="([^"]+)">[\s\S]*?<\/document>/g, (_, name: string) => {
                  docNames.push(name as string);
                  return '';
                })
                .trim();

              return (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed space-y-1.5',
                      msg.role === 'user'
                        ? 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)] rounded-br-sm'
                        : 'bg-[var(--wui-bg-subtle)] text-[var(--wui-fg)] rounded-bl-sm border border-[var(--wui-border)]',
                    )}
                  >
                    {docNames.map((name) => (
                      <div key={name} className="flex items-center gap-1.5 rounded-lg bg-white/20 px-2 py-1">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="text-xs font-medium truncate">{name}</span>
                      </div>
                    ))}
                    {msg.role === 'assistant' && msg.tools && msg.tools.length > 0 && (
                      <ToolChipStrip tools={msg.tools.map((t) => ({ name: t.name, done: true, isError: t.isError }))} />
                    )}
                    {visibleText && (
                      msg.role === 'assistant'
                        ? <MarkdownText text={visibleText} />
                        : <p className="whitespace-pre-wrap">{visibleText}</p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Live streaming assistant turn: tool chips + partial text (or dots). */}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] space-y-1.5 break-words rounded-2xl rounded-bl-sm border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-3 py-2 text-[13px] leading-relaxed text-[var(--wui-fg)]">
                  {streaming.tools.length > 0 && <ToolChipStrip tools={streaming.tools} />}
                  {streaming.text ? <MarkdownText text={streaming.text} /> : <TypingDots />}
                </div>
              </div>
            )}

            {/* Fallback dots when loading but no streaming state was provided. */}
            {isLoading && !streaming && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-3 py-2">
                  <TypingDots />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-[var(--wui-status-failed)] bg-[color-mix(in_srgb,var(--wui-status-failed)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--wui-status-failed)]">
                {error}
              </div>
            )}

          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-[var(--wui-border)] p-3 space-y-2">
            <div className="flex items-end gap-2 rounded-xl border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-3 py-2.5 focus-within:border-[var(--wui-primary)] focus-within:bg-[var(--wui-bg)] transition-colors">
              {inputPrefixSlot}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  onDraftChange(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                rows={1}
                className="flex-1 resize-none bg-transparent text-[13px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)] outline-none"
                style={{ minHeight: '22px', maxHeight: '96px' }}
              />
              {isLoading && onStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  title="Stop"
                  className="flex h-7 w-7 flex-shrink-0 self-end items-center justify-center rounded-lg bg-[var(--wui-status-failed)] text-white transition-all hover:brightness-95 active:scale-95"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onSend()}
                  disabled={!canSend || isLoading}
                  className={cn(
                    'flex h-7 w-7 flex-shrink-0 self-end items-center justify-center rounded-lg transition-all',
                    canSend && !isLoading
                      ? 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)] hover:bg-[var(--wui-primary-hover)] active:scale-95'
                      : 'bg-[var(--wui-bg-subtle)] text-[var(--wui-fg-muted)] cursor-not-allowed border border-[var(--wui-border)]',
                  )}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
