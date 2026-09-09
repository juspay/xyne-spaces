import { ReactElement, useState } from 'react';
import { TextInput, TextArea, Button, ButtonType } from '@juspay/blend-design-system';
import { sanitizeProjectCode, isValidProjectCode } from '@xyne/shared';
import { usePlatform } from '../../../hooks/usePlatform';

interface Project {
  id: string;
  name: string;
  description: string | null;
}

interface ProjectFormProps {
  project?: Project;
  onSubmit: (data: { name?: string; description?: string; code?: string }) => Promise<void> | void;
  onCancel: () => void;
  loading?: boolean;
}

export const ProjectForm = ({
  project,
  onSubmit,
  onCancel,
  loading = false,
}: ProjectFormProps): ReactElement => {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isMobile } = usePlatform();

  const handleSubmit = (): void => {
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    // Validate project code for new projects (required)
    const sanitizedCode = sanitizeProjectCode(code);
    if (!isEdit && !isValidProjectCode(sanitizedCode)) {
      setError('Project code must be at least 2 uppercase letters/numbers (e.g., EU, PR, X2)');
      return;
    }

    void (async (): Promise<void> => {
      try {
        setIsSubmitting(true);
        setError(null);

        if (isEdit) {
          // Edit mode - only send changed fields
          const updateData: { name?: string; description?: string } = {};
          if (name.trim() !== project.name) {
            updateData.name = name.trim();
          }
          const trimmedDescription = description.trim();
          if (trimmedDescription !== (project.description || '')) {
            updateData.description = trimmedDescription;
          }
          await onSubmit(updateData);
        } else {
          // Create mode - send all fields
          const data: { name: string; description?: string; code: string } = {
            name: name.trim(),
            code: sanitizedCode,
          };
          if (description.trim()) {
            data.description = description.trim();
          }
          await onSubmit(data);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} project`,
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  const isLoading = loading || isSubmitting;

  return (
    <div className='space-y-4'>
      {error && (
        <div className='bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded'>
          {error}
        </div>
      )}

      <div>
        <TextInput
          label='Project Name'
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder='Enter project name'
          required
          disabled={isLoading}
          autoFocus={!isMobile}
        />
      </div>

      {!isEdit && (
        <div>
          <TextInput
            label='Project Code (Ticket Prefix)'
            value={code}
            onChange={e => setCode(sanitizeProjectCode(e.target.value))}
            placeholder='e.g., EUL, PROJ, PRO1, XY2'
            required={!isEdit}
            disabled={isLoading}
            hintText={`Tickets will be: ${code || 'CODE'}-0001, ${code || 'CODE'}-0002...`}
            data-testid='project-code-input'
          />
        </div>
      )}

      <div>
        <TextArea
          label='Description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder='Enter project description (optional)'
          rows={4}
          disabled={isLoading}
        />
      </div>

      <div className='flex gap-2 justify-end'>
        <Button
          buttonType={ButtonType.SECONDARY}
          text='Cancel'
          onClick={onCancel}
          disabled={isLoading}
          data-track-category='Projects'
          data-track-name='CancelProjectForm'
          data-track-metadata={JSON.stringify({ projectId: project?.id, isEdit })}
        />
        <Button
          buttonType={ButtonType.PRIMARY}
          text={
            isLoading
              ? isEdit
                ? 'Updating...'
                : 'Creating...'
              : isEdit
                ? 'Update Project'
                : 'Create Project'
          }
          onClick={handleSubmit}
          disabled={isLoading || !name.trim()}
          data-track-category='Projects'
          data-track-name='SubmitProjectForm'
          data-track-metadata={JSON.stringify({ projectId: project?.id, isEdit })}
        />
      </div>
    </div>
  );
};
