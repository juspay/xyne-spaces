import { ReactElement, useState } from 'react';
import { Button } from '../../components/ui/Button/Button';
import FormCard from '../../components/Form/FormCard/FormCard';
import CreateFormModal from '../../components/Form/CreateFormModal/CreateFormModal';
import { queries } from '../../zero/queries';
import type { Form } from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const FormScreen = (): ReactElement => {
  // Fetch all forms using zero
  const [forms] = useCachedQuery(queries.getAllForms());

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedForm, setSelectedForm] = useState<Form | undefined>(undefined);

  const loading = forms === undefined;

  const handleCreateFormClick = (): void => {
    setSelectedForm(undefined);
    setIsCreateModalOpen(true);
  };

  const handleFormCardClick = (form: Form): void => {
    setSelectedForm(form);
    setIsCreateModalOpen(true);
  };

  const handleModalClose = (): void => {
    setIsCreateModalOpen(false);
    setSelectedForm(undefined);
  };

  if (loading) {
    return (
      <div className='h-full bg-gray-50 flex items-center justify-center'>
        <p className='text-gray-600'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full w-full overflow-hidden bg-gray-50'>
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          <div className='flex items-center justify-between p-6 border-b border-gray-200 bg-white'>
            <div>
              <h2 className='text-lg font-bold text-gray-900'>Forms</h2>
              <p className='text-xs text-gray-600 mt-1'>
                Manage and configure forms for different entity types
              </p>
            </div>
            <Button onClick={handleCreateFormClick}>Create Form</Button>
          </div>

          {/* Create/Edit/View Form Modal */}
          {selectedForm ? (
            <CreateFormModal
              open={isCreateModalOpen}
              onOpenChange={handleModalClose}
              form={selectedForm}
            />
          ) : (
            <CreateFormModal open={isCreateModalOpen} onOpenChange={handleModalClose} />
          )}

          <div className='flex-1 overflow-y-auto p-4'>
            {forms && forms.length > 0 ? (
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                {forms.map((form: Form) => (
                  <FormCard key={form.id} form={form} onClick={() => handleFormCardClick(form)} />
                ))}
              </div>
            ) : (
              <div className='text-center py-16'>
                <div className='text-gray-400 text-5xl mb-4'>📋</div>
                <h3 className='text-xl font-semibold text-gray-700 mb-2'>No forms yet</h3>
                <p className='text-gray-500'>Get started by creating your first form</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

FormScreen.displayName = 'FormScreen';

export default FormScreen;
