import React, { useState } from 'react';
import { Popover, Tooltip, TooltipSide } from '@juspay/blend-design-system';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { Smile, X, Image as ImageIcon } from 'lucide-react';
import type { EmojiPickerButtonProps } from './EditorToolbar.types';
import { emojiService } from '../../../services/Emoji/emojiService';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { useTheme } from '../../../hooks/useTheme';

type AddCustomEmojiModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; file: File }) => void;
  isLoading?: boolean;
  error?: string | undefined;
};

export const AddCustomEmojiModal: React.FC<AddCustomEmojiModalProps> = ({
  open,
  onClose,
  onSave,
  isLoading = false,
  error,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');

  if (!open) return null;

  const handleSave = (): void => {
    if (!file || !name) return;
    onSave({ file, name });
    handleClose();
  };

  const handleClose = (): void => {
    setFile(null);
    setName('');
    onClose();
  };

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
        }
      }}
      role='presentation'
    >
      <div className='w-full max-w-[520px] mx-4 rounded-lg bg-background text-foreground shadow-xl'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b'>
          <h2 className='text-lg font-semibold'>Add emoji</h2>
          <button onClick={handleClose}>
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
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <p className='text-xs text-muted-foreground'>Max file size: 500KB</p>
          </div>

          {/* Name */}
          <div className='space-y-2'>
            <p className='font-medium'>2. Give it a name</p>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder=':party_parrot:'
              className='w-full rounded border px-3 py-2 outline-none focus:border-ring'
            />
            <p className='text-xs text-muted-foreground'>Letters, numbers, and underscores only</p>
          </div>

          {/* Error message */}
          {error && <div className='p-3 bg-red-50 text-red-600 rounded text-sm'>{error}</div>}
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-3 px-6 py-4 border-t'>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className='px-4 py-2 rounded hover:bg-accent disabled:opacity-40'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!file || !name || isLoading}
            className='px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40'
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
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
      className={`p-1.5 rounded hover:bg-accent ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      aria-label='Insert emoji'
      data-testid='insert-emoji-btn'
    >
      <Smile className='w-5 h-5 text-muted-foreground' />
    </button>
  );

  return (
    <>
      <Popover
        trigger={
          emojiOpen ? (
            buttonElement
          ) : (
            <Tooltip content='Insert emoji' side={TooltipSide.TOP}>
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
        <div className='w-[350px]'>
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

          {/* Add Emoji Button */}
          <button
            type='button'
            className='flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent'
            onClick={() => {
              setEmojiOpen(false);
              setShowAddEmoji(true);
              setUploadError(undefined);
            }}
          >
            <span>➕</span>
            <span>Add Emoji</span>
          </button>
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
