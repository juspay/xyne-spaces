/**
 * The decision pane — one tag, three shapes depending on where it is in its life.
 *
 * Approval is not a button. An approved entry's description is the classifier's instruction
 * for that type, so promoting a proposal means authoring four fields the proposer never
 * supplied; the pane exists because that does not fit in a row.
 */
import { JSX, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import type { ThreadTypeEntry } from '@xyne/shared';
import type { VocabularyEntry } from '../../../api/threadTypeVocabularyApi';
import { useUser } from '../../../hooks/useUsers';
import { Button } from '../../ui/Button/Button';
import { Input } from '../../ui/Input';
import { cn } from '../../../utils/classNames';
import { colorForTagName } from '../tagColors';

/** The API's floor. It is a prompt, not a tooltip: under twenty characters cannot define a type. */
const MIN_DESCRIPTION = 20;
const MAX_DESCRIPTION = 1200;

/**
 * Must match `promotedForm` in the backend's vocabulary service exactly.
 *
 * Approving under a name the server does not derive the same way leaves every proposal for
 * the original name sitting in the queue forever, because retirement matches on this. That is
 * also why the field is shown and not edited.
 */
const promotedForm = (name: string): string =>
  name
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

const VALID_NAME = /^[A-Z][A-Z0-9_]*$/;

/** A spread wide enough to tell chips apart at a glance, dark enough to read on both themes. */
const PALETTE = [
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#64748b',
];

const formatWhen = (at: number | null | undefined): string =>
  at
    ? new Date(at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'an unknown date';

interface TagDecisionPaneProps {
  entry: VocabularyEntry;
  onClose: () => void;
  onReject: () => void;
  onReconsider: () => void;
  onSave: (entry: ThreadTypeEntry, wasProposal: boolean) => void;
  onRemove: () => void;
  isDeciding: boolean;
}

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: JSX.Element | string;
  children: JSX.Element;
}): JSX.Element => (
  <div className='flex flex-col gap-1.5'>
    <div className='flex items-baseline justify-between gap-2'>
      <span className='text-xs font-medium text-foreground'>{label}</span>
      {hint && <span className='text-[11px] text-muted-foreground'>{hint}</span>}
    </div>
    {children}
  </div>
);

export const TagDecisionPane = ({
  entry,
  onClose,
  onReject,
  onReconsider,
  onSave,
  onRemove,
  isDeciding,
}: TagDecisionPaneProps): JSX.Element => {
  const status = entry.status ?? 'APPROVED';
  const isProposal = status === 'UNDER_REVIEW';
  const isRejected = status === 'REJECTED';
  const proposer = useUser(entry.createdBy ?? '');

  const promoted = useMemo(() => promotedForm(entry.name), [entry.name]);

  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#0891b2');
  const [description, setDescription] = useState('');

  // Keyed on the name so switching rows reloads the form rather than carrying half-typed copy
  // from the previous tag into the next one's approval.
  useEffect(() => {
    setLabel(
      entry.label ||
        // A proposal has no authored label; the name is the only thing the proposer gave.
        entry.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase()),
    );
    setColor(entry.color || colorForTagName(entry.name));
    // For a proposal this is the note its author typed — the only thing to judge on, and the
    // right starting point for the prompt copy.
    setDescription(entry.description ?? '');
  }, [entry.name, entry.label, entry.color, entry.description]);

  const targetName = isProposal ? promoted : entry.name;
  const nameValid = VALID_NAME.test(targetName);
  const trimmed = description.trim();
  const canSave =
    nameValid &&
    label.trim().length > 0 &&
    label.trim().length <= 60 &&
    trimmed.length >= MIN_DESCRIPTION &&
    trimmed.length <= MAX_DESCRIPTION;

  // Named so the footer can say WHY Approve is off. A disabled button with a red counter
  // somewhere above it makes the reader hunt for the connection.
  const blocker = !nameValid
    ? 'That name cannot be stored — turn it down and ask for a rename.'
    : !label.trim()
      ? 'Give it a label.'
      : trimmed.length < MIN_DESCRIPTION
        ? `The definition needs ${MIN_DESCRIPTION - trimmed.length} more character${
            MIN_DESCRIPTION - trimmed.length === 1 ? '' : 's'
          } — it is what the classifier is told about this type.`
        : null;

  const total = entry.threadCount;
  const counted = typeof total === 'number';

  const save = (): void =>
    onSave({ name: targetName, label: label.trim(), color, description: trimmed }, isProposal);

  return (
    <aside className='flex w-[420px] shrink-0 flex-col border-l border-border bg-background'>
      <div className='flex shrink-0 items-start justify-between gap-2 px-5 pt-5'>
        <div className='min-w-0'>
          <div className='font-mono text-sm text-foreground'>{entry.name}</div>
          <div className='mt-0.5 text-xs text-muted-foreground'>
            {entry.createdBy
              ? `Proposed by ${proposer?.name ?? 'someone'} on ${formatWhen(entry.proposedAt)}`
              : 'Added with the standard set'}
          </div>
        </div>
        <Button variant='ghost' size='iconSm' onClick={onClose} aria-label='Close'>
          <X className='size-4' />
        </Button>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
        {/* What the tag is actually doing in the workspace. It is the whole case for or
            against approving it, so it sits above the form rather than under it. */}
        <div className='mb-4 rounded-lg border border-border px-3 py-2.5 text-xs'>
          {!counted ? (
            // Never say "0 threads" when the count simply failed — that is the difference
            // between "nobody wants this tag" and "we could not check", and an admin is about
            // to make a decision on it.
            <span className='text-muted-foreground'>Thread counts are unavailable right now</span>
          ) : (
            <>
              <span className='text-foreground'>
                On {total} {total === 1 ? 'thread' : 'threads'}
              </span>
              {total === 0 && (
                <span className='text-muted-foreground'> · nobody has used it yet</span>
              )}
            </>
          )}
        </div>

        {isRejected ? (
          <div className='flex flex-col gap-3 text-sm'>
            <div className='rounded-lg border border-border px-3 py-2.5'>
              <div className='text-xs font-medium text-foreground'>Turned down</div>
              {/* Turning a name down decides whether it joins the vocabulary — not whether it
                  stays on the threads people put it on. Saying so here stops the obvious
                  misreading that rejecting deletes someone's work. */}
              <p className='mt-1 text-xs text-muted-foreground'>
                Still on the threads that carry it and still findable by search — only kept out of
                the picker and away from the classifier.
              </p>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={onReconsider}
              loading={isDeciding}
              className='self-start'
            >
              <RotateCcw className='size-3.5' />
              Reconsider
            </Button>
          </div>
        ) : (
          <div className='flex flex-col gap-4'>
            {isProposal && (
              <Field label='Will be stored as'>
                <div className='flex items-center gap-2 text-sm'>
                  <span className='font-mono text-muted-foreground'>{entry.name}</span>
                  <span className='text-muted-foreground'>→</span>
                  <span className='font-mono text-foreground'>{promoted}</span>
                </div>
              </Field>
            )}
            {isProposal && !nameValid && (
              <p className='text-xs text-destructive'>
                “{promoted}” is not a usable name — it must start with a letter and contain only
                letters, digits and underscores. Turn this one down and ask for a rename.
              </p>
            )}

            <Field label='Label' hint='What people see on the chip'>
              <Input
                variant='flat'
                value={label}
                maxLength={60}
                onChange={event => setLabel(event.target.value)}
                placeholder='Feature request'
              />
            </Field>

            <Field label='Colour'>
              <div className='flex flex-wrap gap-1.5'>
                {PALETTE.map(swatch => (
                  <button
                    key={swatch}
                    type='button'
                    aria-label={swatch}
                    onClick={() => setColor(swatch)}
                    data-track-category='TagReview'
                    data-track-name='SetColour'
                    className={cn(
                      'size-6 rounded-full transition-transform',
                      color.toLowerCase() === swatch
                        ? 'scale-110 ring-2 ring-offset-1 ring-ring'
                        : '',
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </Field>

            <Field
              label='Definition'
              hint={
                trimmed.length < MIN_DESCRIPTION ? (
                  <span className='text-destructive'>
                    {MIN_DESCRIPTION - trimmed.length} more to go
                  </span>
                ) : (
                  <span>
                    {trimmed.length} / {MAX_DESCRIPTION}
                  </span>
                )
              }
            >
              <textarea
                value={description}
                maxLength={MAX_DESCRIPTION}
                onChange={event => setDescription(event.target.value)}
                data-track-category='TagReview'
                data-track-name='EditDefinition'
                rows={5}
                placeholder='Describe when this type applies, as if instructing someone who has never seen the thread.'
                className={cn(
                  'w-full resize-y rounded-[10px] border border-border bg-background px-3 py-2',
                  'text-sm text-foreground outline-none placeholder:text-muted-foreground',
                  'focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]',
                )}
              />
            </Field>
            {/* Not a tooltip. Saying so where the field is stops descriptions being written as
                one, which is how a classifier ends up guessing. */}
            <p className='-mt-2 text-[11px] text-muted-foreground'>
              This is the instruction the classifier is given for this type.
            </p>

            <Field label='Preview'>
              <span
                className='inline-flex w-fit items-center rounded-full px-1.5 py-[1px] text-[11px] font-medium leading-[16px]'
                style={{ backgroundColor: `${color}1f`, color }}
              >
                {label.trim() || promoted}
              </span>
            </Field>
          </div>
        )}
      </div>

      {!isRejected && (
        <div className='shrink-0 border-t border-border px-5 py-3'>
          {blocker && <p className='mb-2 text-[11px] text-muted-foreground'>{blocker}</p>}
          <div className='flex items-center gap-2'>
            <Button size='sm' disabled={!canSave} loading={isDeciding} onClick={save}>
              <Check className='size-3.5' />
              {isProposal ? 'Approve' : 'Save changes'}
            </Button>
            {isProposal ? (
              <Button variant='outline' size='sm' loading={isDeciding} onClick={onReject}>
                Turn down
              </Button>
            ) : (
              <Button
                variant='ghost'
                size='sm'
                onClick={onRemove}
                loading={isDeciding}
                className='text-muted-foreground'
              >
                <Trash2 className='size-3.5' />
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
