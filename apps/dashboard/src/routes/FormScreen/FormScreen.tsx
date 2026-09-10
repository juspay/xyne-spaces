import { ReactElement, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import { PlusDefault, SearchDefault } from '@xyne/icons';
import type { Form } from '@xyne/shared';
import { Button } from '../../components/ui/Button/Button';
import FormCard from '../../components/Form/FormCard/FormCard';
import CreateFormModal from '../../components/Form/CreateFormModal/CreateFormModal';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const FormScreen = (): ReactElement => {
  // Fetch all forms using zero
  const [forms] = useCachedQuery(queries.getAllForms());

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedForm, setSelectedForm] = useState<Form | undefined>(undefined);
  const [query, setQuery] = useState('');

  const loading = forms === undefined;

  // Entity/context are searchable too, so "board" or "ticket" narrows the list
  // the way the removed tabs used to.
  const fuse = useMemo(
    () =>
      new Fuse(forms ?? [], {
        keys: [
          { name: 'formName', weight: 2 },
          { name: 'entityType', weight: 1 },
          { name: 'contextType', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 1,
      }),
    [forms],
  );

  const visibleForms = useMemo(() => {
    const term = query.trim();
    if (!term) return forms ?? [];
    return fuse.search(term).map(result => result.item);
  }, [forms, fuse, query]);

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
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  const isSearching = query.trim().length > 0;

  return (
    <div
      data-testid='forms-page'
      className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'
    >
      <div className='h-full overflow-y-auto'>
        {/* Full-bleed opaque band so cards can't show through at the column edges */}
        <div className='sticky top-0 z-10 bg-background'>
          <div className='mx-auto flex w-full max-w-[800px] flex-col gap-8 px-6 pb-5 pt-5'>
            <div className='flex items-center gap-5'>
              <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
                <h1 className='text-base font-bold leading-7 tracking-[-0.32px] text-foreground'>
                  Form
                </h1>
                <p className='text-[15px] leading-[1.2] text-muted-foreground'>
                  Manage and configure forms for different entity types
                </p>
              </div>
              <Button
                type='button'
                className='shrink-0'
                onClick={handleCreateFormClick}
                data-track-category='Forms'
                data-track-name='CreateForm'
              >
                <PlusDefault className='size-4' />
                Create Form
              </Button>
            </div>

            <div className='flex h-10 items-center rounded-[12px] border-[0.5px] border-border bg-muted/20 p-1.5'>
              <div className='flex h-7 shrink-0 items-center p-2'>
                <SearchDefault className='size-4 text-muted-foreground' />
              </div>
              <input
                type='text'
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setQuery('');
                }}
                placeholder='Search Forms'
                aria-label='Search forms'
                data-track-category='Forms'
                data-track-name='Search forms'
                className='min-w-0 flex-1 bg-transparent text-sm font-[450] leading-[1.2] text-foreground outline-none placeholder:text-muted-foreground'
              />
            </div>
          </div>
        </div>

        <div className='mx-auto w-full max-w-[800px] px-6 pb-16'>
          {visibleForms.length > 0 ? (
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              {visibleForms.map((form: Form) => (
                <FormCard
                  key={form.id}
                  form={form}
                  onClick={() => handleFormCardClick(form)}
                  data-track-category='Forms'
                  data-track-name='SelectForm'
                  data-track-metadata={JSON.stringify({ formId: form.id })}
                />
              ))}
            </div>
          ) : (
            <div className='text-center py-16'>
              <div className='text-muted-foreground text-5xl mb-4'>📋</div>
              <h3 className='text-xl font-semibold text-foreground mb-2'>
                {isSearching ? 'No matching forms' : 'No forms yet'}
              </h3>
              <p className='text-muted-foreground'>
                {isSearching
                  ? 'Try a different search term'
                  : 'Get started by creating your first form'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit/View Form Modal — portals to body, kept out of the scroll flow */}
      {selectedForm ? (
        <CreateFormModal
          open={isCreateModalOpen}
          onOpenChange={handleModalClose}
          form={selectedForm}
        />
      ) : (
        <CreateFormModal open={isCreateModalOpen} onOpenChange={handleModalClose} />
      )}
    </div>
  );
};

FormScreen.displayName = 'FormScreen';

export default FormScreen;
