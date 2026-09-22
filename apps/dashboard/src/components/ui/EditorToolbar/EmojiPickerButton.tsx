import React, { useEffect, useRef, useState } from 'react';
import { Popover } from '@juspay/blend-design-system';
import Tooltip from '../Tooltip/Tooltip';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { X, Image as ImageIcon } from 'lucide-react';
import { FaceSmile } from '@xyne/icons';
import type { EmojiPickerButtonProps } from './EditorToolbar.types';
import { emojiService } from '../../../services/Emoji/emojiService';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { useTheme } from '../../../hooks/useTheme';
import { OverlayPortal } from '../OverlayPortal';
import { EmojiPickerPreview } from '../../EmojiPickerPreview/EmojiPickerPreview';

type AddCustomEmojiModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; file: File }) => void;
  isLoading?: boolean;
  error?: string | undefined;
};

/** Matches uploadSingle({ maxBytes }) on POST /emojis in apps/backend/src/routes/emojis.ts. */
const MAX_EMOJI_BYTES = 256 * 1024;

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}KB`;

export const AddCustomEmojiModal: React.FC<AddCustomEmojiModalProps> = ({
  open,
  onClose,
  onSave,
  isLoading = false,
  error,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [fileError, setFileError] = useState<string | undefined>();

  // Reset once the parent closes the modal, so the next open starts clean.
  useEffect(() => {
    if (open) return;
    setFile(null);
    setName('');
    setFileError(undefined);
  }, [open]);

  if (!open) return null;

  const handleFileChange = (input: HTMLInputElement): void => {
    const selected = input.files?.[0] ?? null;

    if (selected && selected.size > MAX_EMOJI_BYTES) {
      // Clear the input so re-picking the same file fires onChange again.
      input.value = '';
      setFile(null);
      setFileError(`That image is ${formatBytes(selected.size)}. Maximum size is 256KB.`);
      return;
    }

    setFileError(undefined);
    setFile(selected);
  };

  // The upload is async; leave the modal open so a failure is visible. The parent
  // closes it on success.
  const handleSave = (): void => {
    if (!file || !name) return;
    onSave({ file, name });
  };

  return (
    <OverlayPortal className='flex items-center justify-center bg-black/40' onEscape={onClose}>
      <div className='w-full max-w-[520px] mx-4 rounded-lg bg-background text-foreground shadow-xl'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b'>
          <h2 className='text-lg font-semibold'>Add emoji</h2>
          <button
            onClick={onClose}
            data-track-category='EDITOR_TOOLBAR'
            data-track-name='CLOSE_EMOJI_PICKER'
          >
            <X className='h-5 w-5 text-muted-foreground hover:text-foreground' />
          </button>
        </div>

        {/* Body */}
        <div className='px-6 py-4 space-y-6 text-sm'>
          <p className='text-muted-foreground'>
            Custom emojis will appear in the emoji picker under the custom section.
          </p>

          {/* Upload */}
          <div className='space-y-2'>
            <p className='font-medium'>1. Upload an image</p>
            <div className='flex items-center gap-4'>
              <div className='h-16 w-16 rounded border flex items-center justify-center bg-muted'>
                {file ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt='preview'
                    className='h-12 w-12 object-contain'
                  />
                ) : (
                  <ImageIcon className='h-6 w-6 text-muted-foreground' />
                )}
              </div>

              <label className='cursor-pointer rounded border px-4 py-2 hover:bg-accent'>
                Upload image
                <input
                  type='file'
                  accept='image/png,image/jpeg,image/gif'
                  className='hidden'
                  onChange={e => handleFileChange(e.target)}
                />
              </label>
            </div>
            <p className='text-xs text-muted-foreground'>Max file size: 256KB</p>
          </div>

          {/* Name */}
          <div className='space-y-2'>
            <p className='font-medium'>2. Give it a name</p>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder=':party_parrot:'
              className='w-full bg-background rounded border px-3 py-2 outline-none focus:border-ring'
            />
            <p className='text-xs text-muted-foreground'>Letters, numbers, and underscores only</p>
          </div>

          {/* Error message */}
          {(fileError ?? error) && (
            <div className='p-3 bg-red-50 text-red-600 rounded text-sm'>{fileError ?? error}</div>
          )}
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-3 px-6 py-4 border-t'>
          <button
            onClick={onClose}
            data-track-category='EDITOR_TOOLBAR'
            data-track-name='CANCEL_ADD_CUSTOM_EMOJI'
            disabled={isLoading}
            className='px-4 py-2 rounded hover:bg-accent disabled:opacity-40'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            data-track-category='EDITOR_TOOLBAR'
            data-track-name='SAVE_CUSTOM_EMOJI'
            disabled={!file || !name || isLoading}
            className='px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40'
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </OverlayPortal>
  );
};

export const EmojiPickerButton: React.FC<EmojiPickerButtonProps> = ({
  onEmojiSelect,
  disabled = false,
}) => {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showAddEmoji, setShowAddEmoji] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();

  const { data: customEmojis, refetch } = useCustomEmojis();
  const pickerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;

  const handleCreateEmoji = async ({ file, name }: { name: string; file: File }): Promise<void> => {
    try {
      setIsUploading(true);
      setUploadError(undefined);

      // Upload the file and create the emoji
      await emojiService.uploadAndCreateEmoji(file, name);

      // Refresh the emoji list
      void refetch();

      setShowAddEmoji(false);
      setEmojiOpen(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to create emoji');
    } finally {
      setIsUploading(false);
    }
  };

  const buttonElement = (
    <button
      type='button'
      disabled={disabled}
      onClick={() => setEmojiOpen(true)}
      data-track-category='EDITOR_TOOLBAR'
      data-track-name='OPEN_EMOJI_PICKER'
      className={`p-1.5 rounded hover:bg-accent ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      aria-label='Insert emoji'
      data-testid='insert-emoji-btn'
    >
      <FaceSmile className='h-4 w-4 text-muted-foreground' />
    </button>
  );

  return (
    <>
      <Popover
        trigger={
          emojiOpen ? (
            buttonElement
          ) : (
            <Tooltip
              content='Insert emoji'
              side='top'
              delayDuration={1000}
              skipDelayDuration={1000}
            >
              {buttonElement}
            </Tooltip>
          )
        }
        open={emojiOpen}
        onOpenChange={setEmojiOpen}
        side='top'
        align='start'
        sideOffset={4}
        avoidCollisions
        showCloseButton={false}
      >
        <div className='w-[350px]' data-testid='emoji-picker' ref={pickerRef}>
          <EmojiPicker
            emojiStyle={EmojiStyle.NATIVE}
            theme={emojiPickerTheme}
            style={{
              ['--epr-emoji-size' as string]: '22px',
              ['--epr-emoji-gap' as string]: '4px',
            }}
            onEmojiClick={emojiData => {
              onEmojiSelect(emojiData);
              setEmojiOpen(false);
            }}
            customEmojis={customEmojis || []}
            previewConfig={{ showPreview: false }}
          />

          {/* Footer: hovered emoji preview, falling back to the Add Emoji button */}
          <EmojiPickerPreview containerRef={pickerRef} customEmojis={customEmojis}>
            <button
              type='button'
              className='rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/50'
              onClick={() => {
                setEmojiOpen(false);
                setShowAddEmoji(true);
                setUploadError(undefined);
              }}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='START_ADD_CUSTOM_EMOJI'
            >
              Add Emoji
            </button>
          </EmojiPickerPreview>
        </div>
      </Popover>

      <AddCustomEmojiModal
        open={showAddEmoji}
        onClose={() => setShowAddEmoji(false)}
        onSave={data => {
          void handleCreateEmoji(data);
        }}
        isLoading={isUploading}
        error={uploadError}
      />
    </>
  );
};
