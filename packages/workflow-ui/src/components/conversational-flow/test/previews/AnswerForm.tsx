/**
 * What a question asks for, as the person meets it in a chat.
 *
 * Not a form with labelled boxes: a chat app shows what you can pick as things
 * to tap above the composer, and the composer is where you type. So a choice is
 * chips, a file is an attach row, and what they type goes in the box that is
 * already there — sent together when they press send.
 *
 * The fields are the ones the flow declared (`reply.fields`), so what an author
 * tries here is what their customer is asked for.
 */
import type { TurnField } from '@xyne/workflow-sdk/conversational-flow';
import { Paperclip, X } from 'lucide-react';
import { cn } from '../../../shared/cn.js';

export function AnswerForm({
  fields,
  answer,
  onAnswer,
  ways,
  disabled,
  onSend,
  onLeave,
  className,
}: {
  /** What it asks for, besides the box they type in. */
  fields: TurnField[];
  answer: Record<string, unknown>;
  onAnswer: (name: string, value: unknown) => void;
  /** The ways out — answering is the way on, so these are all it offers. */
  ways?: Array<{ id: string; label: string; kind: 'next' | 'back' | 'finish' }>;
  disabled: boolean;
  /** Shown when there is nothing to type, because then the composer cannot send. */
  onSend?: { label: string; can: boolean; send: () => void } | undefined;
  onLeave?: (way: { id: string; label: string; kind: 'next' | 'back' | 'finish' }) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {fields.map((field) => {
        const label = String(field['label'] ?? field.name);
        if (field.type === 'attachment') return <Attach key={field.name} label={label} name={field.name} answer={answer} onAnswer={onAnswer} disabled={disabled} />;
        if (Array.isArray(field['options'])) return <Pick key={field.name} label={label} name={field.name} field={field} answer={answer} onAnswer={onAnswer} disabled={disabled} />;
        return (
          <label key={field.name} className="flex flex-col gap-1 text-[11px] text-[#8e8e93]">
            {label}
            <input
              className="rounded-[10px] border border-black/10 bg-white px-2 py-1.5 text-[13px] text-black"
              value={String(answer[field.name] ?? '')}
              disabled={disabled}
              onChange={(e) => { onAnswer(field.name, e.target.value); }}
            />
          </label>
        );
      })}

      {(onSend || (ways ?? []).length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {onSend && (
            <button
              type="button"
              disabled={disabled || !onSend.can}
              onClick={onSend.send}
              className="rounded-full bg-[#0a84ff] px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-40"
            >
              {onSend.label}
            </button>
          )}
          {(ways ?? []).map((way) => (
            <button
              key={way.id}
              type="button"
              disabled={disabled}
              onClick={() => onLeave?.(way)}
              className="text-[12px] text-[#8e8e93] underline decoration-dotted underline-offset-2 disabled:opacity-40"
            >
              {way.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What they can pick, as things to tap — the way quick replies look. */
function Pick({
  label,
  name,
  field,
  answer,
  onAnswer,
  disabled,
}: {
  label: string;
  name: string;
  field: TurnField;
  answer: Record<string, unknown>;
  onAnswer: (name: string, value: unknown) => void;
  disabled: boolean;
}) {
  const chosen = answer[name];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-[#8e8e93]">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {(field['options'] as Array<Record<string, unknown>>).map((option, at) => {
          const value = String(option['value'] ?? '');
          const on = chosen === value;
          return (
            <button
              key={at}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              // Tapping picks rather than sends: there may be more to say.
              onClick={() => { onAnswer(name, on ? '' : value); }}
              className={cn(
                'rounded-full border px-3 py-1 text-[13px] transition-colors disabled:opacity-40',
                on ? 'border-transparent bg-[#0a84ff] font-medium text-white' : 'border-black/15 bg-white text-black',
              )}
            >
              {String(option['label'] ?? value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A file, as a chat app offers one: a paperclip, then what is attached. */
function Attach({
  label,
  name,
  answer,
  onAnswer,
  disabled,
}: {
  label: string;
  name: string;
  answer: Record<string, unknown>;
  onAnswer: (name: string, value: unknown) => void;
  disabled: boolean;
}) {
  const file = answer[name] as { name?: string } | undefined;
  if (file?.name) {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-black">
        <Paperclip className="h-3.5 w-3.5 text-[#8e8e93]" aria-hidden />
        <span className="truncate">{file.name}</span>
        <button type="button" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => { onAnswer(name, undefined); }}>
          <X className="h-3.5 w-3.5 text-[#8e8e93]" />
        </button>
      </div>
    );
  }
  return (
    <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-black/15 bg-white px-3 py-1 text-[12.5px] text-black">
      <Paperclip className="h-3.5 w-3.5 text-[#8e8e93]" aria-hidden />
      {label}
      {/* Test stands in for the upload: a real client sends an Attachment ref. */}
      <input
        type="file"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onAnswer(name, { name: picked.name, mimeType: picked.type || 'application/octet-stream', handle: picked.name });
        }}
      />
    </label>
  );
}
