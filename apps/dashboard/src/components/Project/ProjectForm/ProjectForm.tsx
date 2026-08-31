import { ReactElement, useState } from 'react';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { posthogService } from '../../../services/Analytics/posthogService';
import { EVENTS, EVENT_PROPERTIES } from '../../../services/Analytics/events';
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

          // Track project creation (no sensitive data - only metadata)
          posthogService.capture(EVENTS.INITIATE_ACTION, {
            type: EVENT_PROPERTIES.ACTION_TYPES.PROJECT_CREATED,
          });
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
    <form
      className='flex flex-col gap-4 p-6'
      noValidate
      onSubmit={e => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className='flex flex-col gap-1.5'>
        <h2 className='text-base font-semibold text-foreground'>
          {isEdit ? 'Edit project' : 'Create new project'}
        </h2>
        <p className='text-sm text-muted-foreground'>
          {isEdit
            ? 'Update the name and description for this project.'
            : 'Name your project and pick a code for its ticket IDs.'}
        </p>
      </div>

      {error && (
        <p className='rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
          {error}
        </p>
      )}

      <div className='flex flex-col gap-1.5'>
        <label htmlFor='project-name' className='text-sm font-medium text-foreground'>
          Project name
        </label>
        <Input
          id='project-name'
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder='Enter project name'
          required
          disabled={isLoading}
          autoFocus={!isMobile}
        />
      </div>

      {!isEdit && (
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='project-code' className='text-sm font-medium text-foreground'>
            Project code
          </label>
          <Input
            id='project-code'
            value={code}
            onChange={e => setCode(sanitizeProjectCode(e.target.value))}
            placeholder='e.g., EUL, PROJ, PRO1, XY2'
            required
            disabled={isLoading}
            data-testid='project-code-input'
          />
          <p className='text-xs text-muted-foreground'>
            Tickets will be: {code || 'CODE'}-0001, {code || 'CODE'}-0002...
          </p>
        </div>
      )}

      <div className='flex flex-col gap-1.5'>
        <label htmlFor='project-description' className='text-sm font-medium text-foreground'>
          Description
        </label>
        <Textarea
          id='project-description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder='Enter project description (optional)'
          rows={4}
          disabled={isLoading}
        />
      </div>

      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={onCancel}
          disabled={isLoading}
          data-track-category='Projects'
          data-track-name='CancelProjectForm'
          data-track-metadata={JSON.stringify({ projectId: project?.id, isEdit })}
        >
          Cancel
        </Button>
        <Button
          type='submit'
          size='sm'
          loading={isLoading}
          disabled={isLoading || !name.trim()}
          data-track-category='Projects'
          data-track-name='SubmitProjectForm'
          data-track-metadata={JSON.stringify({ projectId: project?.id, isEdit })}
        >
          {isEdit ? 'Update project' : 'Create project'}
        </Button>
      </div>
    </form>
  );
};
