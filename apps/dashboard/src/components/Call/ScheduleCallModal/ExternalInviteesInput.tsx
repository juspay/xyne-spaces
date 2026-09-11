import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../utils/classNames';

interface ExternalInviteesInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Emails to show as pre-filled chips on first mount, keyed by prefillKey. */
  suggestedEmails: string[];
  /** Re-running this key resets the "already prefilled" guard (e.g. switching ticket). */
  prefillKey: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ExternalInviteesInput: React.FC<ExternalInviteesInputProps> = ({
  value,
  onChange,
  suggestedEmails,
  prefillKey,
}) => {
  const chips = value ?? [];
  const suggestions = suggestedEmails ?? [];
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const commit = useCallback(
    (raw: string) => {
      const email = normalize(raw);
      if (!email) return;
      if (!EMAIL_RE.test(email)) {
        setInvalid(true);
        return;
      }
      if (chips.includes(email)) {
        setDraft('');
        setInvalid(false);
        return;
      }
      onChange([...chips, email]);
      setDraft('');
      setInvalid(false);
    },
    [chips, onChange],
  );

  const remove = useCallback(
    (email: string) => onChange(chips.filter(e => e !== email)),
    [chips, onChange],
  );

  return (
    <div>
      <label
        className={cn(
          'flex flex-wrap gap-1 p-2 border rounded-md min-h-[40px] items-center cursor-text',
          invalid ? 'border-red-500' : 'border-border',
        )}
      >
        {chips.map(email => (
          <span
            key={email}
            className='inline-flex items-center gap-1.5 bg-muted rounded pl-2 pr-1 py-0.5 text-sm'
          >
            <span className='select-none'>{email}</span>
            <button
              type='button'
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                remove(email);
              }}
              className='inline-flex items-center justify-center size-4 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors'
              aria-label={`Remove ${email}`}
              data-track-category='CALLS'
              data-track-name='remove-external-invitee'
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type='text'
          className='flex-1 min-w-[180px] outline-none bg-transparent text-sm'
          placeholder={chips.length === 0 ? 'Add guest emails…' : ''}
          value={draft}
          data-track-category='CALLS'
          data-track-name='external-invitee-input'
          onChange={e => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && chips.length > 0) {
              const last = chips[chips.length - 1];
              if (last) remove(last);
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
      </label>
      {invalid && <p className='mt-1 text-xs text-red-500'>Invalid email address</p>}
    </div>
  );
};

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
