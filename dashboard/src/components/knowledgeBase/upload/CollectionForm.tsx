import React from 'react';
import { RadioGroup, Radio } from '../../ui/RadioGroup/RadioGroup';
import { FileUploadZone } from './FileUploadZone';

interface CollectionFormProps {
  files: File[];
  isPrivate: boolean;
  onFilesChange: (files: File[]) => void;
  onIsPrivateChange: (isPrivate: boolean) => void;
  disabled?: boolean;
  /** If true, only allow folder selection via the upload zone. */
  folderOnly?: boolean;
}

export const CollectionForm: React.FC<CollectionFormProps> = ({
  files,
  isPrivate,
  onFilesChange,
  onIsPrivateChange,
  disabled = false,
  folderOnly = false,
}) => {
  return (
    <div className='space-y-3'>
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
        folderOnly={folderOnly}
      />
    </div>
  );
};
