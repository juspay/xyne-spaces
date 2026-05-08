import React, { useCallback, ChangeEvent } from 'react';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { FileUploadZone } from './FileUploadZone';

const MAX_DESCRIPTION_CHARS = 1000;

interface CollectionFormProps {
  title: string;
  description: string;
  files: File[];
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  nameError?: string | undefined;
}

/**
 * Collection Form Component
 * Contains title, description fields and file upload zone
 */
export const CollectionForm: React.FC<CollectionFormProps> = ({
  title,
  description,
  files,
  onTitleChange,
  onDescriptionChange,
  onFilesChange,
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
