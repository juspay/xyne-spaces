import React, { useState, useEffect } from 'react';
import { Link as LinkIcon, Trash2, Plus, Globe, Lock, Pencil } from 'lucide-react';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { DelayedSpinner } from '../../ui/DelayedSpinner';
import { useZero } from '../../../hooks/useZero';
import type { Link } from '@xyne/shared';
import { LinkVisibility } from '@xyne/shared';
import Dialog from '../../ui/Dialog';
import { browserPanelActor } from '../../../machines/browserPanelMachine';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { isElectronApp } from '../../../utils/electronApp';
import { openLink, getLinkOpenExternalDefault } from '../../../utils/openLink';

interface LinksTabProps {
  channelId: string;
}

const LinksTab: React.FC<LinksTabProps> = ({ channelId }) => {
  const zero = useZero();
  const context = useAuthContextValues();
  const [links, linksDetails] = useCachedQuery(queries.channelLinks({ channelId }));
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [linkToDelete, setLinkToDelete] = useState<Link | null>(null);
  const [linkToEdit, setLinkToEdit] = useState<Link | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const [formData, setFormData] = useState({
    url: '',
    title: '',
    description: '',
    visibility: 'DEFAULT' as 'DEFAULT' | 'PERSONAL',
  });

  useEffect(() => {
    const shouldOpenAll = searchParams.get('openAllLinks') === 'true';
    if (shouldOpenAll && links && links.length > 0) {
      const urls = links.map(link => link.url);

      if (isElectronApp()) {
        xyneAIActor.send({ type: 'CLOSE' });
        browserPanelActor.send({ type: 'OPEN', urls });
      } else {
        urls.forEach(url => window.open(url, '_blank'));
      }

      void navigate(`${baseRoute}/${channelId}?tab=links`, { replace: true });
    }
  }, [searchParams, links, navigate, baseRoute, channelId]);

  const sharedLinks = links.filter(link => link.visibility === LinkVisibility.DEFAULT);
  const personalAndSharedLinks = links.filter(
    link =>
      link.visibility === LinkVisibility.PERSONAL ||
      link.sharedWith?.some(sw => sw.userId === context.userID),
  );

  const handleAddOrUpdateLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.url || !formData.title) return;

    const now = Date.now();

    if (linkToEdit) {
      zero.mutate(
        mutators.links.update({
          id: linkToEdit.id,
          title: formData.title,
          description: formData.description || undefined,
          visibility: formData.visibility,
          updatedAt: now,
        }),
      );
    } else {
      // Create new link
      zero.mutate(
        mutators.links.create({
          id: crypto.randomUUID(),
          url: formData.url,
          title: formData.title,
          description: formData.description || undefined,
          channelId,
          visibility: formData.visibility,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    // Reset form and close dialog
    setFormData({ url: '', title: '', description: '', visibility: 'DEFAULT' });
    setLinkToEdit(null);
    setIsDialogOpen(false);
  };

  const handleEditLink = (link: Link, e: React.MouseEvent) => {
    e.stopPropagation();
    setLinkToEdit(link);
    setFormData({
      url: link.url,
      title: link.title,
      description: link.description || '',
      visibility: link.visibility as 'DEFAULT' | 'PERSONAL',
    });
    setIsDialogOpen(true);
  };

  const handleDeleteLink = (link: Link) => {
    setLinkToDelete(link);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!linkToDelete) return;
    zero.mutate(mutators.links.delete({ id: linkToDelete.id }));
    setIsDeleteDialogOpen(false);
    setLinkToDelete(null);
  };

  const handleOpenLink = (
    url: string,
    event?: React.MouseEvent | React.KeyboardEvent | null,
  ): void => {
    const modifier = !!(event?.metaKey || event?.ctrlKey);
    const wantExternal = getLinkOpenExternalDefault() !== modifier;

    if (isElectronApp() && !wantExternal) {
      xyneAIActor.send({ type: 'CLOSE' });
    }
    openLink(url, event ?? null);
  };

  const renderLinkCard = (link: Link) => {
    const isOwner = link.createdBy === context.userID;
    const isSharedWithMe = !isOwner && link.visibility === LinkVisibility.PERSONAL;

    return (
      <div
        key={link.id}
        role='button'
        tabIndex={0}
        onClick={e => handleOpenLink(link.url, e)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpenLink(link.url, e);
          }
        }}
        className='group flex items-start gap-3 p-3 rounded-lg border border-border hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer'
        data-track-category='CHANNEL_LINKS'
        data-track-name='OpenLink'
        data-track-metadata={JSON.stringify({ linkId: link.id, url: link.url, title: link.title })}
      >
        {link.favicon ? (
          <img src={link.favicon} alt='' className='w-4 h-4 flex-shrink-0 mt-0.5' />
        ) : (
          <LinkIcon size={16} className='text-muted-foreground flex-shrink-0 mt-0.5' />
        )}

        <div className='flex-1 min-w-0'>
          <div className='font-medium text-sm text-foreground truncate group-hover:text-blue-700'>
            {link.title}
            {isSharedWithMe && (
              <span className='ml-2 text-xs text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded'>
                Shared
              </span>
            )}
          </div>
          <div className='text-xs text-muted-foreground truncate mt-0.5'>{link.url}</div>
          {link.description && (
            <div className='text-xs text-muted-foreground mt-1.5 line-clamp-2'>
              {link.description}
            </div>
          )}
        </div>

        {isOwner && (
          <div className='flex items-center gap-1 opacity-0 group-hover:opacity-100'>
            <button
              onClick={e => handleEditLink(link, e)}
              className='p-1.5 rounded-md hover:bg-blue-100 text-blue-600 transition-opacity'
              title='Edit link'
              data-track-category='CHANNEL_LINKS'
              data-track-name='EditLink'
              data-track-metadata={JSON.stringify({
                linkId: link.id,
                title: link.title,
                url: link.url,
              })}
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={e => {
                e.stopPropagation();
                handleDeleteLink(link);
              }}
              className='p-1.5 rounded-md hover:bg-red-100 text-red-600 transition-opacity'
              title='Delete link'
              data-track-category='CHANNEL_LINKS'
              data-track-name='DeleteLink'
              data-track-metadata={JSON.stringify({
                linkId: link.id,
                title: link.title,
                url: link.url,
              })}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className='flex flex-col h-full bg-background'>
      {/* Header */}
      <div className='flex items-center justify-between p-4 border-b border-border bg-card'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Links</h2>
          <p className='text-sm text-muted-foreground'>Quick access to important resources</p>
        </div>
        <Dialog
          open={isDialogOpen}
          onOpenChange={open => {
            setIsDialogOpen(open);
            if (!open) {
              setLinkToEdit(null);
              setFormData({ url: '', title: '', description: '', visibility: 'DEFAULT' });
            }
          }}
          trigger={
            <button
              className='flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm'
              data-track-category='CHANNEL_LINKS'
              data-track-name='OpenAddLinkDialog'
            >
              <Plus size={16} />
              Add Link
            </button>
          }
        >
          <div className='p-6'>
            <h3 className='text-lg font-semibold text-foreground mb-4'>
              {linkToEdit ? 'Edit Link' : 'Add New Link'}
            </h3>
            <form onSubmit={handleAddOrUpdateLink} className='space-y-4'>
              <div>
                <label
                  htmlFor='link-url'
                  className='block text-sm font-medium text-foreground mb-1.5'
                >
                  URL <span className='text-red-500'>*</span>
                </label>
                <input
                  id='link-url'
                  type='url'
                  value={formData.url}
                  onChange={e => setFormData({ ...formData, url: e.target.value })}
                  placeholder='https://example.com'
                  required
                  disabled={!!linkToEdit}
                  className='w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-foreground disabled:bg-muted disabled:cursor-not-allowed'
                  data-track-category='CHANNEL_LINKS'
                  data-track-name='EditLinkUrl'
                  data-track-metadata={JSON.stringify({
                    linkId: linkToEdit?.id,
                    url: formData.url,
                  })}
                />
                {linkToEdit && (
                  <p className='text-xs text-muted-foreground mt-1'>
                    URL cannot be changed when editing
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor='link-title'
                  className='block text-sm font-medium text-foreground mb-1.5'
                >
                  Title <span className='text-red-500'>*</span>
                </label>
                <input
                  id='link-title'
                  type='text'
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  placeholder='Link title'
                  required
                  className='w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-foreground'
                  data-track-category='CHANNEL_LINKS'
                  data-track-name='EditLinkTitle'
                  data-track-metadata={JSON.stringify({
                    linkId: linkToEdit?.id,
                    title: formData.title,
                    url: formData.url,
                  })}
                />
              </div>
              <div>
                <label
                  htmlFor='link-description'
                  className='block text-sm font-medium text-foreground mb-1.5'
                >
                  Description
                </label>
                <textarea
                  id='link-description'
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder='Optional description'
                  rows={3}
                  className='w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-foreground resize-none'
                  data-track-category='CHANNEL_LINKS'
                  data-track-name='EditLinkDescription'
                  data-track-metadata={JSON.stringify({
                    linkId: linkToEdit?.id,
                    description: formData.description,
                    url: formData.url,
                    title: formData.title,
                  })}
                />
              </div>
              <fieldset>
                <legend className='block text-sm font-medium text-foreground mb-1.5'>
                  Visibility
                </legend>
                <div className='grid grid-cols-2 gap-3'>
                  <button
                    type='button'
                    onClick={() => setFormData({ ...formData, visibility: 'DEFAULT' })}
                    className={`flex items-center bg-background gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                      formData.visibility === 'DEFAULT'
                        ? 'border-blue-500'
                        : 'border-border hover:border-border'
                    }`}
                    data-track-category='CHANNEL_LINKS'
                    data-track-name='SelectSharedVisibility'
                    data-track-metadata={JSON.stringify({
                      linkId: linkToEdit?.id,
                      visibility: 'DEFAULT',
                    })}
                  >
                    <Globe size={16} className='text-foreground' />
                    <div className='text-left'>
                      <div className='text-sm font-medium text-foreground'>Shared</div>
                      <div className='text-xs text-muted-foreground'>Everyone in channel</div>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => setFormData({ ...formData, visibility: 'PERSONAL' })}
                    className={`flex items-center bg-background gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                      formData.visibility === 'PERSONAL'
                        ? 'border-blue-500'
                        : 'border-border hover:border-border'
                    }`}
                    data-track-category='CHANNEL_LINKS'
                    data-track-name='SelectPersonalVisibility'
                    data-track-metadata={JSON.stringify({
                      linkId: linkToEdit?.id,
                      visibility: 'PERSONAL',
                    })}
                  >
                    <Lock size={16} className='text-foreground' />
                    <div className='text-left'>
                      <div className='text-sm font-medium text-foreground'>Personal</div>
                      <div className='text-xs text-muted-foreground'>Only visible to you</div>
                    </div>
                  </button>
                </div>
              </fieldset>
              <div className='flex gap-3 pt-2'>
                <button
                  type='button'
                  onClick={() => {
                    setIsDialogOpen(false);
                    setLinkToEdit(null);
                    setFormData({ url: '', title: '', description: '', visibility: 'DEFAULT' });
                  }}
                  className='flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-accent transition-colors text-sm font-medium'
                  data-track-category='CHANNEL_LINKS'
                  data-track-name='CancelAddLink'
                  data-track-metadata={JSON.stringify({ linkId: linkToEdit?.id })}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  className='flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium'
                  data-ph-capture-attribute-track-id={
                    linkToEdit ? 'update_channel_link' : 'create_channel_link'
                  }
                >
                  {linkToEdit ? 'Update Link' : 'Add Link'}
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      </div>

      {/* Two-column Layout */}
      <div className='flex-1 overflow-auto bg-muted'>
        {linksDetails.type !== 'complete' && links.length === 0 ? (
          <DelayedSpinner className='flex h-full items-center justify-center' />
        ) : links.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-muted-foreground p-8'>
            <LinkIcon size={48} className='mb-4 opacity-20' />
            <p className='text-sm text-muted-foreground font-medium'>No links yet</p>
            <p className='text-xs text-muted-foreground mt-1'>Add your first link to get started</p>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4 p-4 h-full'>
            {/* Shared Links Column */}
            <div className='flex flex-col bg-card rounded-lg border border-border overflow-hidden'>
              <div className='flex items-center gap-2 px-4 py-3 border-b border-border bg-gradient-to-r from-blue-50 to-blue-100'>
                <Globe size={16} className='text-blue-600' />
                <h3 className='text-sm font-semibold text-blue-900'>Public Links</h3>
                <span className='ml-auto text-xs text-blue-600 bg-blue-200 px-2 py-0.5 rounded-full'>
                  {sharedLinks.length}
                </span>
              </div>
              <div className='flex-1 overflow-auto p-3 space-y-2'>
                {sharedLinks.length === 0 ? (
                  <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                    <Globe size={32} className='mb-2 opacity-20' />
                    <p className='text-xs'>No Public links yet</p>
                  </div>
                ) : (
                  sharedLinks.map(link => renderLinkCard(link))
                )}
              </div>
            </div>

            {/* Personal/Shared Links Column */}
            <div className='flex flex-col bg-card rounded-lg border border-border overflow-hidden'>
              <div className='flex items-center gap-2 px-4 py-3 border-b border-border bg-gradient-to-r from-purple-50 to-purple-100'>
                <Lock size={16} className='text-purple-600' />
                <h3 className='text-sm font-semibold text-purple-900'>Personal Links</h3>
                <span className='ml-auto text-xs text-purple-600 bg-purple-200 px-2 py-0.5 rounded-full'>
                  {personalAndSharedLinks.length}
                </span>
              </div>
              <div className='flex-1 overflow-auto p-3 space-y-2'>
                {personalAndSharedLinks.length === 0 ? (
                  <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                    <Lock size={32} className='mb-2 opacity-20' />
                    <p className='text-xs'>No personal or shared links yet</p>
                  </div>
                ) : (
                  personalAndSharedLinks.map(link => renderLinkCard(link))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <div className='p-6'>
          <div className='flex items-center gap-3 mb-4'>
            <div className='w-12 h-12 rounded-full bg-red-100 flex items-center justify-center'>
              <Trash2 size={24} className='text-red-600' />
            </div>
            <div>
              <h3 className='text-lg font-semibold text-foreground'>Delete Link</h3>
              <p className='text-sm text-muted-foreground'>This action cannot be undone</p>
            </div>
          </div>

          {linkToDelete && (
            <div className='bg-muted rounded-lg p-4 mb-6'>
              <div className='flex items-start gap-3'>
                {linkToDelete.favicon ? (
                  <img src={linkToDelete.favicon} alt='' className='w-4 h-4 flex-shrink-0 mt-0.5' />
                ) : (
                  <LinkIcon size={16} className='text-muted-foreground flex-shrink-0 mt-0.5' />
                )}
                <div className='flex-1 min-w-0'>
                  <div className='font-medium text-sm text-foreground truncate'>
                    {linkToDelete.title}
                  </div>
                  <div className='text-xs text-muted-foreground truncate mt-0.5'>
                    {linkToDelete.url}
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className='text-sm text-muted-foreground mb-6'>
            Are you sure you want to delete this link? This will permanently remove it from the
            channel.
          </p>

          <div className='flex gap-3'>
            <button
              type='button'
              onClick={() => setIsDeleteDialogOpen(false)}
              className='flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-accent transition-colors text-sm font-medium'
              data-track-category='CHANNEL_LINKS'
              data-track-name='CancelDeleteLink'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={confirmDelete}
              className='flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium'
              data-track-category='CHANNEL_LINKS'
              data-track-name='ConfirmDeleteLink'
              data-ph-capture-attribute-track-id='delete_channel_link'
            >
              Delete Link
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default LinksTab;
