import { ReactElement, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { CopyDefault as Copy, CheckTickSingle as Check } from '@xyne/icons';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { toast } from 'sonner';
import type { Project } from '@xyne/shared';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';

interface ProjectCardProps {
  project: Project;
  // Optional: when omitted, the Edit button is hidden (read-only browse views).
  onEdit?: (project: Project) => void;
  // When set, ProjectDetailScreen reads this from location.state to open on a
  // specific tab. Used by the Release Manager view to jump straight into
  // the release tab instead of the default boards tab.
  initialDetailTab?: 'boards' | 'release';
  onConfigureRelease?: (project: Project) => void;
}

export const ProjectCard = ({
  project,
  onEdit,
  initialDetailTab,
  onConfigureRelease,
}: ProjectCardProps): ReactElement => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  // All workspace codes in one deduped query; this project's codes are the ones
  // whose namespace belongs to it. project.code is the default; extras are board codes.
  const [namespaces] = useCachedQuery(queries.allTicketNamespaces());
  const projectNamespaces = useMemo(() => {
    const list = (namespaces && !(namespaces instanceof Error) ? namespaces : []).filter(
      namespace => namespace.projectId === project.id,
    );
    // Default code first, then the rest in their existing order.
    return [...list].sort((a, b) => {
      if (a.id === project.defaultTicketNamespaceId) return -1;
      if (b.id === project.defaultTicketNamespaceId) return 1;
      return 0;
    });
  }, [namespaces, project.id, project.defaultTicketNamespaceId]);

  // Codes to badge. With namespaces, show each (default first); without any (a
  // project not yet backfilled / feature not activated), fall back to project.code
  // so the card still shows the project's prefix instead of nothing.
  const displayCodes = useMemo(() => {
    if (projectNamespaces.length > 0) {
      return projectNamespaces.map(namespace => ({
        key: namespace.id,
        code: namespace.code,
        isDefault: namespace.id === project.defaultTicketNamespaceId,
      }));
    }
    return project.code ? [{ key: 'project-code', code: project.code, isDefault: true }] : [];
  }, [projectNamespaces, project.defaultTicketNamespaceId, project.code]);

  const handleCardClick = (): void => {
    const state =
      initialDetailTab === 'release'
        ? { tab: initialDetailTab, from: 'releaseManager' }
        : initialDetailTab
          ? { tab: initialDetailTab }
          : undefined;
    void navigate(`/listProjects/${project.id}`, state ? { state } : undefined);
  };

  const handleEditClick = (e?: React.MouseEvent<HTMLButtonElement>): void => {
    e?.stopPropagation();
    onEdit?.(project);
  };

  const handleCopyId = (e: React.MouseEvent): void => {
    e.stopPropagation();
    copyTextToClipboard(project.id)
      .then(() => {
        toast.success('Project ID copied to clipboard');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        toast.error('Failed to copy project ID');
      });
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
      className='bg-background rounded-lg shadow-sm border border-border p-6 hover:shadow-md transition-shadow cursor-pointer'
      data-track-category='Projects'
      data-track-name='OpenProject'
      data-track-metadata={JSON.stringify({ projectId: project.id, projectName: project.name })}
    >
      <div className='flex items-start justify-between mb-4'>
        <div className='flex-1'>
          <div className='flex flex-wrap items-center gap-2 mb-2'>
            <h3 className='text-lg font-semibold text-foreground'>{project.name}</h3>
            {displayCodes.map(({ key, code, isDefault }) => (
              <span
                key={key}
                title={isDefault ? 'Default code' : undefined}
                className={`px-2 py-0.5 text-xs font-medium rounded ${
                  isDefault ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}
              >
                {code}
              </span>
            ))}
          </div>
          {project.description && (
            <p className='text-sm text-muted-foreground line-clamp-2'>{project.description}</p>
          )}
        </div>
      </div>

      <div className='border-t border-border pt-4 mt-4'>
        <div className='text-xs text-muted-foreground mb-3'>
          <p>Created: {new Date(project.createdAt).toLocaleDateString()}</p>
          <div className='flex items-center gap-1 mt-1'>
            <span className='text-xs text-muted-foreground'>ID:</span>
            <code className='text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[160px]'>
              {project.id}
            </code>
            <Button
              variant='ghost'
              size='iconSm'
              className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
              onClick={handleCopyId}
              data-track-category='Projects'
              data-track-name='COPY_PROJECT_ID'
              title='Copy project ID'
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </Button>
          </div>
        </div>

        {(onEdit || onConfigureRelease) && (
          <div className='flex gap-2'>
            {onEdit && (
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
            )}
            {onConfigureRelease && (
              <Button
                variant='secondary'
                onClick={e => {
                  e.stopPropagation();
                  onConfigureRelease(project);
                }}
              >
                Configure repositories
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
