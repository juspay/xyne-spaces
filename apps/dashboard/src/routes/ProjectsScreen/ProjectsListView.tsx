import { ReactElement, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { ProjectForm, ProjectCard } from '../../components/Project';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import { AccessType, type Project as ZeroProject } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { usePlatform } from '../../hooks/usePlatform';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { DownloadDown as Download } from '@xyne/icons';

const ProjectsListView = (): ReactElement => {
  const zero = useZero();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState<ZeroProject | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = usePermissions();
  const canExportTickets = permissions.some(
    permission =>
      permission.resourceName === 'TICKET-REPORTS' &&
      (permission.accessType === AccessType.WRITE || permission.accessType === AccessType.ADMIN),
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Fetch all projects using zero
  const [projects] = useCachedQuery(queries.getAllProjects());

  const loading = projects === undefined;
  const filteredProjects = searchQuery.trim()
    ? (projects ?? []).filter(p => {
        const q = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
      })
    : (projects ?? []);

  const handleCreateProject = async (data: {
    name?: string;
    description?: string;
  }): Promise<void> => {
    // Only called in create mode, so we know all fields are present
    await apiInstance.post('/projects', data);
    setShowCreateModal(false);
  };

  const handleUpdateProject = async (
    projectId: string,
    data: { name?: string; description?: string },
  ): Promise<void> => {
    const result = zero.mutate(
      mutators.project.update({
        projectId,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        timestamp: Date.now(),
      }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Action Failed', {
        description: res.error.message || 'You do not have permission to modify this.',
        duration: 5000,
      });
    } else {
      setEditingProject(null);
    }
  };

  useEffect((): (() => void) | undefined => {
    if (isMobile || editingProject || showCreateModal) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile, editingProject, showCreateModal]);

  if (loading) {
    return (
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div
      data-testid='list-projects-page'
      className='h-full bg-background flex flex-col md:rounded-2xl overflow-hidden shadow-md'
    >
      <div className='flex-1 overflow-y-auto p-4'>
        {/* Header */}
        <div className='mb-6'>
          <div className='flex items-center justify-between mb-2'>
            <h2 className='text-lg font-bold text-foreground'>Projects</h2>
            <div className='flex items-center gap-2'>
              {canExportTickets && (
                <button
                  type='button'
                  onClick={() => {
                    void navigate(
                      `${user?.workspaceId ? `/${user.workspaceId}` : ''}/ticket-reports?from=listProjects`,
                    );
                  }}
                  className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent'
                  data-track-category='TicketReports'
                  data-track-name='OpenReportsFromProjectList'
                >
                  <Download className='size-4' />
                  Export report
                </button>
              )}
              <Button
                size='sm'
                onClick={() => setShowCreateModal(true)}
                data-track-category='Projects'
                data-track-name='CreateProject'
              >
                New
              </Button>
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>Manage your projects</p>
          <div className='mt-3'>
            <input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder='Search by name or project code...'
              className='w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='Projects'
              data-track-name='SearchProjects'
            />
          </div>
        </div>

        {/* Projects List */}
        <div className='space-y-3' data-testid='project-list'>
          {filteredProjects.map(project => (
            <ProjectCard key={project.id} project={project} onEdit={setEditingProject} />
          ))}
        </div>

        {/* Empty State */}
        {filteredProjects.length === 0 && (
          <div className='text-center py-8'>
            <div className='text-muted-foreground text-3xl mb-3'>📁</div>
            {searchQuery.trim() ? (
              <>
                <h3 className='text-sm font-semibold text-foreground mb-1'>No projects found</h3>
                <p className='text-xs text-muted-foreground'>
                  No results for &quot;{searchQuery}&quot;
                </p>
              </>
            ) : (
              <>
                <h3 className='text-sm font-semibold text-foreground mb-1'>No projects yet</h3>
                <p className='text-xs text-muted-foreground'>Create your first project</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <Dialog
          open={true}
          onOpenChange={open => !open && setShowCreateModal(false)}
          title='Create new project'
          description='Name your project and pick a code for its ticket IDs.'
          testId='create-project-dialog'
        >
          <ProjectForm onSubmit={handleCreateProject} onCancel={() => setShowCreateModal(false)} />
        </Dialog>
      )}

      {/* Edit Modal */}
      {editingProject && (
        <Dialog
          open={true}
          onOpenChange={open => !open && setEditingProject(null)}
          title='Edit project'
          description='Update the name and description for this project.'
          testId='edit-project-dialog'
        >
          <ProjectForm
            project={editingProject}
            onSubmit={data => handleUpdateProject(editingProject.id, data)}
            onCancel={() => setEditingProject(null)}
          />
        </Dialog>
      )}
    </div>
  );
};

ProjectsListView.displayName = 'ProjectsListView';

export default ProjectsListView;
