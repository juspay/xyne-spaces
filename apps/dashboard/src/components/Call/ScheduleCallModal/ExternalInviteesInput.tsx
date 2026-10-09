import React, { useState, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Mail, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';

export interface ExternalInviteesInputHandle {
  focus: () => void;
}

interface ExternalInviteesInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Emails to show as pre-filled chips on first mount, keyed by prefillKey. */
  suggestedEmails: string[];
  /** Re-running this key resets the "already prefilled" guard (e.g. switching ticket). */
  prefillKey: string;
  /** Entries that are not valid addresses. They stay as red chips until fixed or removed. */
  onInvalidCountChange?: (count: number) => void;
  hasError?: boolean;
  ref?: React.Ref<ExternalInviteesInputHandle>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Keys that end an entry while typing, matching the separators a pasted list may use. */
const SEPARATOR_KEYS = new Set(['Enter', ',', ';', ' ']);

export const ExternalInviteesInput: React.FC<ExternalInviteesInputProps> = ({
  value,
  onChange,
  suggestedEmails,
  prefillKey,
  onInvalidCountChange,
  hasError = false,
  ref,
}) => {
  const chips = value ?? [];
  const suggestions = suggestedEmails ?? [];
  const [draft, setDraft] = useState('');
  const [invalidEntries, setInvalidEntries] = useState<string[]>([]);
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  useEffect(() => {
    onInvalidCountChange?.(invalidEntries.length);
  }, [invalidEntries.length, onInvalidCountChange]);

  useEffect(() => {
    if (prefilledFor === prefillKey) return;
    // Wait for suggestions to actually arrive — the parent's query is async,
    // so the first render typically hands us an empty array. Marking the key
    // as prefilled now would skip the real prefill once data lands.
    if (suggestions.length === 0) return;
    if (chips.length === 0) {
      onChange(Array.from(new Set(suggestions.map(normalize))));
    }
    setPrefilledFor(prefillKey);
  }, [prefillKey, prefilledFor, suggestions, chips.length, onChange]);

  /** Adds every entry in `raw` — one address or a pasted list. */
  const commit = useCallback(
    (raw: string) => {
      const entries = splitEntries(raw);
      if (entries.length === 0) return;
      const nextValid = [...chips];
      const nextInvalid = [...invalidEntries];
      for (const entry of entries) {
        const email = normalize(entry);
        if (EMAIL_RE.test(email)) {
          if (!nextValid.includes(email)) nextValid.push(email);
        } else if (!nextInvalid.includes(entry)) {
          nextInvalid.push(entry);
        }
      }
      if (nextValid.length !== chips.length) onChange(nextValid);
      setInvalidEntries(nextInvalid);
      setDraft('');
    },
    [chips, invalidEntries, onChange],
  );

  const remove = useCallback(
    (email: string) => onChange(chips.filter(e => e !== email)),
    [chips, onChange],
  );

  const removeInvalid = useCallback(
    (entry: string) => setInvalidEntries(prev => prev.filter(e => e !== entry)),
    [],
  );

  /** Pulls an invalid entry back into the input so it can be corrected. */
  const editInvalid = useCallback(
    (entry: string) => {
      if (draft.trim()) commit(draft);
      removeInvalid(entry);
      setDraft(entry);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [commit, draft, removeInvalid],
  );

  const hasInvalid = invalidEntries.length > 0;

  return (
    <div>
      <label
        className={cn(
          'flex flex-wrap gap-1 px-3 py-1 border rounded-lg min-h-9 items-center cursor-text bg-background',
          'focus-within:ring-1 focus-within:ring-ring',
          hasInvalid || hasError ? 'border-red-500' : 'border-border',
        )}
      >
        <Mail className='size-4 shrink-0 text-muted-foreground mr-1.5' aria-hidden />
        {chips.map(email => (
          <span
            key={email}
            className='inline-flex items-center gap-1.5 bg-background border border-border rounded-md pl-2 pr-1 py-0.5 text-sm'
          >
            <span className='select-none'>{email}</span>
            <button
              type='button'
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                remove(email);
              }}
              className='inline-flex items-center justify-center size-4 rounded hover:bg-accent text-foreground transition-colors'
              aria-label={`Remove ${email}`}
              data-track-category='CALLS'
              data-track-name='remove-external-invitee'
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {invalidEntries.map(entry => (
          <span
            key={entry}
            className='inline-flex items-center gap-1 rounded pl-2 pr-1 py-0.5 text-sm bg-red-500/10 text-red-600 dark:text-red-400'
          >
            <button
              type='button'
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                editInvalid(entry);
              }}
              className='select-none hover:underline'
              title='Not a valid email — click to fix'
              aria-label={`Fix ${entry}`}
              data-track-category='CALLS'
              data-track-name='fix-invalid-external-invitee'
            >
              {entry}
            </button>
            <button
              type='button'
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                removeInvalid(entry);
              }}
              className='inline-flex items-center justify-center size-4 rounded hover:bg-red-500/15 transition-colors'
              aria-label={`Remove ${entry}`}
              data-track-category='CALLS'
              data-track-name='remove-invalid-external-invitee'
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type='text'
          className='flex-1 min-w-[180px] h-7 outline-none bg-transparent text-sm placeholder:text-muted-foreground'
          placeholder={
            chips.length === 0 && !hasInvalid ? 'Guest emails — paste a list to add several' : ''
          }
          value={draft}
          aria-invalid={hasInvalid || hasError}
          data-track-category='CALLS'
          data-track-name='external-invitee-input'
          onChange={e => setDraft(e.target.value)}
          onPaste={e => {
            const text = e.clipboardData.getData('text');
            if (splitEntries(text).length > 1) {
              e.preventDefault();
              commit(`${draft} ${text}`);
            }
          }}
          onKeyDown={e => {
            if (SEPARATOR_KEYS.has(e.key)) {
              // A space inside "Name <addr>" is part of the entry, not a separator.
              if (e.key === ' ' && draft.includes('<') && !draft.includes('>')) return;
              if (!draft.trim()) {
                if (e.key !== 'Enter') e.preventDefault();
                return;
              }
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft) {
              const lastInvalid = invalidEntries[invalidEntries.length - 1];
              const last = chips[chips.length - 1];
              if (lastInvalid) removeInvalid(lastInvalid);
              else if (last) remove(last);
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
      </label>
      {hasInvalid && (
        <p className='mt-1 text-xs text-red-500'>
          {invalidEntries.length === 1
            ? '1 entry is not a valid email — click it to fix'
            : `${invalidEntries.length} entries are not valid emails — click one to fix`}
        </p>
      )}
    </div>
  );
};

/**
 * Splits a typed or pasted list on commas, semicolons, whitespace and newlines.
 * `Name <addr>` entries are kept whole so their display name isn't split into
 * bogus addresses.
 */
function splitEntries(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .flatMap(part => (/<[^>]+>/.test(part) ? [part] : part.split(/\s+/)))
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Normalize an address that may arrive as either:
 *   - `alice@example.com`
 *   - `Alice <alice@example.com>`
 *   - `"Alice A." <alice@example.com>`
 * into a plain lowercased address. Everything outside the last `<...>` is
 * discarded so upstream Zod email validation accepts it.
 */
function normalize(s: string): string {
  const trimmed = s.trim();
  const angle = /<([^>]+)>\s*$/.exec(trimmed);
  return (angle ? angle[1]! : trimmed).trim().toLowerCase();
}
