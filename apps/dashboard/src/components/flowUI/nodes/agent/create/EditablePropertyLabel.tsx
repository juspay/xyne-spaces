import { useRef, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';

interface EditablePropertyLabelProps {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  testId?: string;
  /** Shown while the title field is empty. Custom rows pass the type name. */
  placeholder?: string;
  /** Extra classes. Custom titles pass the agent-handle color here. */
  className?: string;
}

/** Click-to-edit title. Enter or blur commits; Escape restores the previous title. */
export function EditablePropertyLabel({
  value,
  onCommit,
  disabled = false,
  testId,
  placeholder,
  className,
}: EditablePropertyLabelProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelRef = useRef(false);
  const showingPlaceholder = value.trim().length === 0 && Boolean(placeholder);

  if (!editing) {
    return (
      <button
        type='button'
        disabled={disabled}
        data-testid={testId}
        data-track-category='Claw Agents'
        data-track-name='Create agent: edit property title'
        onClick={() => {
          cancelRef.current = false;
          setDraft(value);
          setEditing(true);
        }}
        className={cn(
          'w-full truncate bg-transparent p-0 text-left text-sm font-normal leading-[1.3] tracking-[-0.1px] outline-none disabled:opacity-60',
          showingPlaceholder ? 'text-fg-placeholder' : (className ?? 'text-inherit'),
        )}
      >
        {showingPlaceholder ? placeholder : value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      data-testid={testId ? `${testId}-input` : undefined}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label='Property title'
      onChange={event => setDraft(event.target.value)}
      data-track-category='Claw Agents'
      data-track-name='Create agent: property title'
      onBlur={() => {
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(value);
          setEditing(false);
          return;
        }
        const next = draft.trim();
        onCommit(next.length > 0 ? next : value);
        setEditing(false);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelRef.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        'w-full border-0 bg-transparent p-0 text-sm font-normal leading-[1.3] tracking-[-0.1px] outline-none placeholder:font-normal placeholder:text-fg-placeholder placeholder:opacity-100 focus:placeholder:text-fg-placeholder',
        draft.trim().length === 0 && placeholder ? 'text-fg-placeholder' : 'text-foreground',
      )}
    />
  );
}
