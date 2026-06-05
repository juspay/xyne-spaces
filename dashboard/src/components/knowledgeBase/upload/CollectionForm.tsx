import React, { useCallback, ChangeEvent } from 'react';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { RadioGroup, Radio } from '../../ui/RadioGroup/RadioGroup';
import { FileUploadZone } from './FileUploadZone';

const MAX_DESCRIPTION_CHARS = 1000;

interface CollectionFormProps {
  title: string;
  description: string;
  files: File[];
  isPrivate: boolean;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onFilesChange: (files: File[]) => void;
  onIsPrivateChange: (isPrivate: boolean) => void;
  disabled?: boolean;
  nameError?: string | undefined;
}

export const CollectionForm: React.FC<CollectionFormProps> = ({
  title,
  description,
  files,
  isPrivate,
  onTitleChange,
  onDescriptionChange,
  onFilesChange,
  onIsPrivateChange,
  disabled = false,
  nameError,
}) => {
  const charCountExcludingSpaces = description.replace(/\s/g, '').length;

  const handleDescriptionChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      const countExclSpaces = val.replace(/\s/g, '').length;
      if (countExclSpaces <= MAX_DESCRIPTION_CHARS) {
        onDescriptionChange(val);
      }
    },
    [onDescriptionChange],
  );

  return (
    <div className='space-y-4'>
      {/* Collection Title */}
      <div>
        <label htmlFor='collection-title' className='block text-sm font-medium text-gray-700 mb-1'>
          Collection title
        </label>
        <Input
          id='collection-title'
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder='Add Collection Name'
          disabled={disabled}
        />
        {nameError && <p className='text-sm text-red-500 mt-1'>{nameError}</p>}
      </div>

      {/* Visibility */}
      <RadioGroup
        name='visibility'
        label='Visibility'
        value={isPrivate ? 'private' : 'public'}
        onChange={value => onIsPrivateChange(value === 'private')}
        disabled={disabled}
      >
        <Radio value='public'>Public — anyone can upload and view</Radio>
        <Radio value='private'>Private — invite only</Radio>
      </RadioGroup>

      {/* File Upload Zone */}
      <FileUploadZone
        files={files}
        onFilesChange={onFilesChange}
        disabled={disabled}
        showInfo={true}
      />

      {/* Description */}
      <div>
        <label
          htmlFor='collection-description'
          className='block text-sm font-medium text-gray-700 mb-1'
        >
          Description
        </label>
        <Textarea
          id='collection-description'
          value={description}
          onChange={handleDescriptionChange}
          placeholder='Enter summary here...'
          rows={3}
          disabled={disabled}
        />
        <p className='text-xs text-gray-400 mt-1'>
          {charCountExcludingSpaces}/{MAX_DESCRIPTION_CHARS} characters (excluding spaces)
        </p>
      </div>
    </div>
  );
};
