import React, { useState } from 'react';
import { Popover, Tooltip, TooltipSide } from '@juspay/blend-design-system';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import { Smile, X, Image as ImageIcon } from 'lucide-react';
import type { EmojiPickerButtonProps } from './EditorToolbar.types';
import { emojiService } from '../../../services/Emoji/emojiService';
import { emojiActor } from '../../../machines/emojiMachine';
import { useSelector } from '@xstate/react';

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
  };

  const handleClose = (): void => {
    setFile(null);
    setName('');
    onClose();
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'>
      <div className='w-[520px] rounded-lg bg-white text-gray-900 shadow-xl'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b'>
          <h2 className='text-lg font-semibold'>Add emoji</h2>
          <button onClick={handleClose}>
            <X className='h-5 w-5 text-gray-500 hover:text-gray-800' />
          </button>
        </div>

        {/* Body */}
        <div className='px-6 py-4 space-y-6 text-sm'>
          <p className='text-gray-600'>
            Custom emojis will appear in the emoji picker under the custom section.
          </p>

          {/* Upload */}
          <div className='space-y-2'>
            <p className='font-medium'>1. Upload an image</p>
            <div className='flex items-center gap-4'>
              <div className='h-16 w-16 rounded border flex items-center justify-center bg-gray-50'>
                {file ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt='preview'
                    className='h-12 w-12 object-contain'
                  />
                ) : (
                  <ImageIcon className='h-6 w-6 text-gray-400' />
                )}
              </div>

              <label className='cursor-pointer rounded border px-4 py-2 hover:bg-gray-100'>
                Upload image
                <input
                  type='file'
                  accept='image/png,image/jpeg,image/gif'
                  className='hidden'
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <p className='text-xs text-gray-500'>Max file size: 500KB</p>
          </div>

          {/* Name */}
          <div className='space-y-2'>
            <p className='font-medium'>2. Give it a name</p>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder=':party_parrot:'
              className='w-full rounded border px-3 py-2 outline-none focus:border-gray-500'
            />
            <p className='text-xs text-gray-500'>Letters, numbers, and underscores only</p>
          </div>

          {/* Error message */}
          {error && <div className='p-3 bg-red-50 text-red-600 rounded text-sm'>{error}</div>}
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-3 px-6 py-4 border-t'>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className='px-4 py-2 rounded hover:bg-gray-100 disabled:opacity-40'
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

  // Get custom emojis from XState
  const customEmojis = useSelector(emojiActor, state => state.context.customEmojis);

  const handleCreateEmoji = async ({ file, name }: { name: string; file: File }): Promise<void> => {
    try {
      setIsUploading(true);
      setUploadError(undefined);

      // Upload the file and create the emoji
      await emojiService.uploadAndCreateEmoji(file, name);

      // Refresh the emoji list via XState
      emojiActor.send({ type: 'REFRESH_EMOJIS' });

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
      className={`p-1.5 rounded hover:bg-gray-100 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      aria-label='Insert emoji'
    >
      <Smile className='w-4 h-4 text-gray-600' />
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
            onEmojiClick={emojiData => {
              onEmojiSelect(emojiData);
              setEmojiOpen(false);
            }}
            customEmojis={customEmojis || []}
          />

          {/* Add Emoji Button */}
          <button
            type='button'
            className='flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100'
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
