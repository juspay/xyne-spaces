/**
 * The test conversation, drawn the way the person would really see it.
 *
 * Every preview runs the same conversation — the same turns from the
 * Conversation API, the same replies going back — because that is what an
 * integration is: a turn is `messages`, `reply.options` and whether typing is
 * allowed, and each channel draws those its own way. Only the drawing lives
 * here; nothing about the run changes with the choice.
 */
import { useState } from 'react';
import { MessageCircle, Monitor, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../shared/cn.js';
import { readPref, writePref } from '../../panel.js';
import type { ConversationRun } from '../useConversation.js';
import { useChat } from './chat.js';
import { AppChat } from './AppChat.js';
import { WhatsAppChat } from './WhatsAppChat.js';

export type PreviewId = 'web' | 'ios' | 'android' | 'whatsapp';

export const PREVIEWS: Array<{ id: PreviewId; label: string; Icon: LucideIcon }> = [
  { id: 'web', label: 'Web', Icon: Monitor },
  { id: 'ios', label: 'iPhone', Icon: Smartphone },
  { id: 'android', label: 'Android', Icon: Smartphone },
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
];

const isPreview = (v: string | null): v is PreviewId => PREVIEWS.some((p) => p.id === v);

/** The chosen preview, remembered like the map's direction. */
export function usePreview(): [PreviewId, (id: PreviewId) => void] {
  const [preview, setPreview] = useState<PreviewId>(() => {
    const saved = readPref('preview');
    return isPreview(saved) ? saved : 'web';
  });
  return [
    preview,
    (id: PreviewId) => {
      setPreview(id);
      writePref('preview', id);
    },
  ];
}

export function PreviewPicker({ value, onChange }: { value: PreviewId; onChange: (id: PreviewId) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Preview"
      className="flex items-center gap-1 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-muted)] p-1"
    >
      {PREVIEWS.map(({ id, label, Icon }) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-[calc(var(--wui-radius)-4px)] px-2.5 py-1.5 text-[12px] leading-none transition-colors',
              on
                ? 'bg-[var(--wui-primary)] font-semibold text-[var(--wui-primary-fg)] shadow-[var(--wui-shadow)]'
                : 'font-medium text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg)] hover:text-[var(--wui-fg)]',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function PreviewChat({ run, preview }: { run: ConversationRun; preview: PreviewId }) {
  const chat = useChat(run);
  // The merchant's own app — one design, three sets of chrome. WhatsApp is
  // someone else's app, so it is drawn on its own terms.
  if (preview === 'whatsapp') return <WhatsAppChat chat={chat} />;
  return <AppChat chat={chat} platform={preview} />;
}
