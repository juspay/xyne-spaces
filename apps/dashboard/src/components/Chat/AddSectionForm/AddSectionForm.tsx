import { useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { X } from 'lucide-react';
import { SectionEmojiPicker } from '../SectionEmojiPicker';

export interface AddSectionFormData {
  name: string;
  emoji?: string;
}

interface AddSectionFormProps {
  onSubmit: (data: AddSectionFormData) => void;
  onCancel: () => void;
  loading?: boolean;
  initialName?: string;
  initialEmoji?: string;
  existingNames?: string[];
  submitLabel?: string;
  title?: string;
}

export const AddSectionForm = ({
  onSubmit,
  onCancel,
  loading = false,
  initialName = '',
  initialEmoji = '',
  existingNames = [],
  submitLabel = 'Create section',
  title = 'Create a section',
}: AddSectionFormProps): ReactElement => {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [touched, setTouched] = useState(false);

  const trimmedName = name.trim();
  const isDuplicateName = existingNames.some(
    n => n.trim().toLowerCase() === trimmedName.toLowerCase(),
  );
  const nameError =
    trimmedName.length === 0
      ? 'Section name is required'
      : trimmedName.length > 50
        ? 'Section name must be 50 characters or less'
        : isDuplicateName
          ? 'A section with this name already exists'
          : null;
  const showError = touched && !!nameError;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (nameError) {
      setTouched(true);
      return;
    }
    const trimmedEmoji = emoji.trim();
    onSubmit(trimmedEmoji ? { name: trimmedName, emoji: trimmedEmoji } : { name: trimmedName });
  };

  return (
    <form onSubmit={handleSubmit} className='space-y-4' data-testid='add-section-form'>
      <div className='flex items-start justify-between gap-2'>
        <div className='text-xl font-medium text-foreground'>{title}</div>
        <button
          type='button'
          onClick={onCancel}
          aria-label='Close'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='CLOSE_RENAME_SECTION'
          className='-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <X className='size-5' />
        </button>
      </div>
      <div className='space-y-1.5'>
        <label htmlFor='section-name' className='text-sm font-medium text-foreground'>
          Section name
        </label>
        <div
          className={cn(
            'flex items-center gap-1 rounded-md border bg-background px-2 transition-colors',
            showError
              ? 'border-destructive'
              : 'border-border focus-within:ring-2 focus-within:ring-ring',
          )}
        >
          <SectionEmojiPicker value={emoji} onChange={setEmoji} trackName='RENAME_SECTION_EMOJI' />
          <input
            id='section-name'
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setName(e.target.value);
              setTouched(true);
            }}
            onKeyDown={e => {
              if (
                e.key === 'Backspace' &&
                emoji &&
                e.currentTarget.selectionStart === 0 &&
                e.currentTarget.selectionEnd === 0
              ) {
                e.preventDefault();
                setEmoji('');
              }
            }}
            placeholder='Ex: Project Beta'
            maxLength={50}
            autoFocus
            autoComplete='off'
            aria-invalid={showError}
            data-track-category='CHAT_SIDEBAR'
            data-track-name='RENAME_SECTION_NAME'
            className='flex-1 border-0 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
          />
        </div>
        {showError && <p className='text-sm text-destructive'>{nameError}</p>}
      </div>
      <div className='flex justify-end gap-3 pt-2'>
        <Button
          variant='outline'
          size='default'
          type='button'
          onClick={onCancel}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='CANCEL_ADD_SECTION'
        >
          Cancel
        </Button>
        <Tooltip content={nameError ?? ''} side='top' {...(!nameError && { open: false })}>
          <span className='inline-flex'>
            <Button
              variant='default'
              size='default'
              type='submit'
              loading={loading}
              disabled={!!nameError}
              className={cn(
                'bg-action-primary text-action-primary-foreground hover:bg-action-primary/90',
                !!nameError && 'pointer-events-none',
              )}
            >
              {submitLabel}
            </Button>
          </span>
        </Tooltip>
      </div>
    </form>
  );
};

export default AddSectionForm;
