import { ReactElement, useState } from 'react';
import { useZero } from '../../hooks/useZero';
import { toast } from 'sonner';
import { Button, ButtonType, Modal } from '@juspay/blend-design-system';
import { ProjectForm, ProjectCard } from '../../components/Project';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import type { Project as ZeroProject } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const ProjectsListView = (): ReactElement => {
  const zero = useZero();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState<ZeroProject | null>(null);

  // Fetch all projects using zero
  const [projects] = useCachedQuery(queries.getAllProjects());

  const loading = projects === undefined;

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

  const handleDeleteProject = async (projectId: string): Promise<void> => {
    const result = zero.mutate(mutators.project.delete({ projectId }));
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Action Failed', {
        description: res.error.message || 'You do not have permission to delete this.',
        duration: 5000,
      });
    }
  };

  if (loading) {
    return (
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full bg-background flex flex-col md:rounded-2xl overflow-hidden shadow-md'>
      <div className='flex-1 overflow-y-auto p-4'>
        {/* Header */}
        <div className='mb-6'>
          <div className='flex items-center justify-between mb-2'>
            <h2 className='text-lg font-bold text-foreground'>Projects</h2>
            <Button
              buttonType={ButtonType.PRIMARY}
              text='New'
              onClick={() => setShowCreateModal(true)}
              data-track-category='Projects'
              data-track-name='CreateProject'
            />
          </div>
          <p className='text-xs text-muted-foreground'>Manage your projects</p>
        </div>

        {/* Projects List */}
        <div className='space-y-3'>
          {projects?.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={setEditingProject}
              onDelete={projectId => void handleDeleteProject(projectId)}
            />
          ))}
        </div>

        {/* Empty State */}
        {projects?.length === 0 && (
          <div className='text-center py-8'>
            <div className='text-muted-foreground text-3xl mb-3'>📁</div>
            <h3 className='text-sm font-semibold text-foreground mb-1'>No projects yet</h3>
            <p className='text-xs text-muted-foreground'>Create your first project</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <Modal
          isOpen={true}
          onClose={() => setShowCreateModal(false)}
          title='Create New Project'
          showCloseButton={true}
          closeOnBackdropClick={false}
        >
          <ProjectForm onSubmit={handleCreateProject} onCancel={() => setShowCreateModal(false)} />
        </Modal>
      )}

      {/* Edit Modal */}
      {editingProject && (
        <Modal
          isOpen={true}
          onClose={() => setEditingProject(null)}
          title='Edit Project'
          showCloseButton={true}
          closeOnBackdropClick={false}
        >
          <ProjectForm
            project={editingProject}
            onSubmit={data => handleUpdateProject(editingProject.id, data)}
            onCancel={() => setEditingProject(null)}
          />
        </Modal>
      )}
    </div>
  );
};

ProjectsListView.displayName = 'ProjectsListView';

export default ProjectsListView;
