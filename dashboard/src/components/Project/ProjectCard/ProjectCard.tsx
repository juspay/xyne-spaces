import { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import type { Project } from '@xyne/shared';

interface ProjectCardProps {
  project: Project;
  onEdit: (project: Project) => void;
  onDelete: (projectId: string) => void;
}

export const ProjectCard = ({ project, onEdit, onDelete }: ProjectCardProps): ReactElement => {
  const navigate = useNavigate();

  const handleCardClick = (): void => {
    void navigate(`/listProjects/${project.id}`);
  };

  const handleEditClick = (e?: React.MouseEvent<HTMLButtonElement>): void => {
    e?.stopPropagation();
    onEdit(project);
  };

  const handleDeleteClick = (e?: React.MouseEvent<HTMLButtonElement>): void => {
    e?.stopPropagation();
    void onDelete(project.id);
  };

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      role='button'
      tabIndex={0}
      data-testid={`project-card-${project.id}`}
      data-project-name={project.name}
      className='bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer'
      data-track-category='Projects'
      data-track-name='OpenProject'
      data-track-metadata={JSON.stringify({ projectId: project.id, projectName: project.name })}
    >
      <div className='flex items-start justify-between mb-4'>
        <div className='flex-1'>
          <h3 className='text-lg font-semibold text-gray-900 mb-2'>{project.name}</h3>
          {project.description && (
            <p className='text-sm text-gray-600 line-clamp-2'>{project.description}</p>
          )}
        </div>
      </div>

      <div className='border-t border-gray-100 pt-4 mt-4'>
        <div className='text-xs text-gray-500 mb-3'>
          <p>Created: {new Date(project.createdAt).toLocaleDateString()}</p>
        </div>

        <div className='flex gap-2'>
          <Button
            variant='secondary'
            onClick={handleEditClick}
            data-track-category='Projects'
            data-track-name='EditProject'
            data-track-metadata={JSON.stringify({
              projectId: project.id,
              projectName: project.name,
            })}
          >
            Edit
          </Button>
          <Button
            variant='destructive'
            onClick={handleDeleteClick}
            data-track-category='Projects'
            data-track-name='DeleteProject'
            data-track-metadata={JSON.stringify({
              projectId: project.id,
              projectName: project.name,
            })}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
};
