import React, { type DragEvent, useEffect, useRef } from 'react';
import { cn } from '../../../utils/classNames';
import { EmailTagWithAvatar } from '../EmailTagWithAvatar/EmailTagWithAvatar';
import { RecipientSuggestionsDropdown } from '../RecipientSuggestionsDropdown/RecipientSuggestionsDropdown';
import { useUsers } from '../../../hooks/useUsers';
import type { RecipientSuggestion } from '../RecipientSuggestionsDropdown/RecipientSuggestionsDropdown';
import type { RecipientField as FieldType } from './recipients';

const RECIPIENT_CHIP_COLLAPSED_COUNT = 4;
const RECIPIENT_FIELD_EXPANDED_MAX_H_PX = 200;
const RECIPIENT_FIELD_COLLAPSED_MAX_H_PX = 72;

interface RecipientFieldProps {
  field: FieldType;
  label: string;
  emails: string[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  rowRef: React.RefObject<HTMLDivElement | null>;
  inputValue: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onEmailsChange: (next: string[]) => void;
  onInputValueChange: (value: string) => void;
  suggestions: RecipientSuggestion[];
  activeSuggestField: FieldType | null;
  highlightedIndex: number;
  onSuggestionSelect: (field: FieldType, email: string) => void;
  onHighlight: (index: number) => void;
  disabled: boolean;
  users: ReturnType<typeof useUsers>;
  dragOverField: FieldType | null;
  handleChipDragStart: (field: FieldType, email: string) => (e: DragEvent<HTMLDivElement>) => void;
  handleChipDragEnd: () => void;
  handleFieldDragOver: (field: FieldType) => (e: DragEvent<HTMLDivElement>) => void;
  handleFieldDragLeave: (field: FieldType) => (e: DragEvent<HTMLDivElement>) => void;
  handleFieldDrop: (field: FieldType) => (e: DragEvent<HTMLDivElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleBlur: () => void;
  focusSuggest: (field: FieldType) => void;
  trackCategory?: string;
  trackName?: string;
  trackMetadata?: Record<string, unknown>;
  /** Optional action controls rendered at the right edge of the row.
   *  Use this for Cc / Bcc toggles and composer-level actions so they
   *  stay visually anchored to the recipient field regardless of chip
   *  wrapping. */
  actions?: React.ReactNode;
  /** Extra classes applied to the component’s outermost wrapper.
   *  Useful when the field lives inside a flex parent and needs to
   *  expand (e.g. flex-1 min-w-0). */
  className?: string;
}

export const RecipientField = ({
  field,
  label,
  emails,
  inputRef,
  rowRef,
  inputValue,
  expanded,
  onExpandedChange,
  onEmailsChange,
  onInputValueChange,
  suggestions,
  activeSuggestField,
  highlightedIndex,
  onSuggestionSelect,
  onHighlight,
  disabled,
  users,
  dragOverField,
  handleChipDragStart,
  handleChipDragEnd,
  handleFieldDragOver,
  handleFieldDragLeave,
  handleFieldDrop,
  handleKeyDown,
  handleBlur,
  focusSuggest,
  trackCategory = 'Support',
  trackName,
  trackMetadata,
  actions,
  className,
}: RecipientFieldProps): React.ReactElement => {
  const visibleEmails = expanded ? emails : emails.slice(0, RECIPIENT_CHIP_COLLAPSED_COUNT);
  const hiddenCount = Math.max(0, emails.length - RECIPIENT_CHIP_COLLAPSED_COUNT);
  const hasMore = !expanded && hiddenCount > 0;
  const canCollapse = expanded && emails.length > RECIPIENT_CHIP_COLLAPSED_COUNT;
  const prevLenRef = useRef(emails.length);

  useEffect(() => {
    if (
      !expanded &&
      emails.length > prevLenRef.current &&
      emails.length > RECIPIENT_CHIP_COLLAPSED_COUNT
    ) {
      onExpandedChange(true);
    }
    prevLenRef.current = emails.length;
  }, [emails.length, expanded, onExpandedChange]);

  const inputSize = Math.max(
    1,
    inputValue.length || (emails.length === 0 ? 'Add recipients...'.length : 0),
  );

  return (
    <div
      className={cn(
        'grid items-start mt-0.5',
        /* label (auto) | chips (1fr) | actions (auto) */
        actions ? 'grid-cols-[auto_1fr_auto] gap-2' : 'grid-cols-[auto_1fr] gap-2',
        className,
      )}
    >
      <span className='text-sm text-foreground font-medium flex-shrink-0 mt-1'>{label}</span>

      <div
        ref={rowRef}
        className={cn(
          'relative flex flex-wrap items-center gap-1.5 min-h-[28px] cursor-text rounded-md transition-colors',
          dragOverField === field && 'outline-dashed outline-1 outline-primary/40 outline-offset-2',
        )}
        onClick={() => inputRef.current?.focus()}
        onKeyDown={e => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
        onDragOver={handleFieldDragOver(field)}
        onDragLeave={handleFieldDragLeave(field)}
        onDrop={handleFieldDrop(field)}
        role='button'
        tabIndex={0}
        data-track-category={trackCategory}
        data-track-name={trackName}
        data-track-metadata={trackMetadata ? JSON.stringify(trackMetadata) : undefined}
      >
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 overscroll-contain',
            expanded ? 'overflow-y-auto' : 'overflow-hidden',
          )}
          style={{
            maxHeight: expanded
              ? `${RECIPIENT_FIELD_EXPANDED_MAX_H_PX}px`
              : `${RECIPIENT_FIELD_COLLAPSED_MAX_H_PX}px`,
          }}
        >
          {visibleEmails.map(email => (
            <EmailTagWithAvatar
              key={email}
              email={email}
              onRemove={() => onEmailsChange(emails.filter(e => e !== email))}
              disabled={disabled}
              users={users}
              draggable
              onDragStart={handleChipDragStart(field, email)}
              onDragEnd={handleChipDragEnd}
            />
          ))}
          <span className='inline-flex items-center gap-1 min-w-[80px]'>
            <input
              ref={inputRef}
              type='text'
              size={inputSize}
              value={inputValue}
              onChange={e => {
                onInputValueChange(e.target.value);
                onHighlight(0);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => focusSuggest(field)}
              onBlur={handleBlur}
              placeholder={emails.length === 0 ? 'Add recipients...' : ''}
              className='text-sm py-1 outline-none bg-transparent'
              disabled={disabled}
              data-track-category={trackCategory}
              data-track-name={`Edit${label}Field`}
              data-track-metadata={trackMetadata ? JSON.stringify(trackMetadata) : undefined}
            />
            {hasMore && (
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation();
                  onExpandedChange(true);
                }}
                aria-label={`Expand to see ${hiddenCount} more ${label} recipients`}
                aria-expanded={false}
                className='inline-flex items-center gap-1 bg-muted/80 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
                data-track-category='Support'
                data-track-name={`Expand${label}Field`}
              >
                +{hiddenCount} more
              </button>
            )}
            {canCollapse && (
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation();
                  onExpandedChange(false);
                }}
                aria-label={`Collapse ${label} recipient list`}
                aria-expanded={true}
                className='inline-flex items-center gap-1 bg-muted/80 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
                data-track-category='Support'
                data-track-name={`Collapse${label}Field`}
              >
                Show less
              </button>
            )}
          </span>
        </div>
        <RecipientSuggestionsDropdown
          visible={activeSuggestField === field}
          suggestions={suggestions}
          highlightedIndex={highlightedIndex}
          onSelect={email => onSuggestionSelect(field, email)}
          onHighlight={onHighlight}
          anchorRef={rowRef}
        />
      </div>

      {actions && <div className='flex items-center gap-1 flex-shrink-0 mt-0.5'>{actions}</div>}
    </div>
  );
};
