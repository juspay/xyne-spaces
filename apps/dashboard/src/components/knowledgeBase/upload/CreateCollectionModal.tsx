import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Hash, Plus } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import { useAuth } from '../../../hooks/useAuth';
import type { CollectionSummary } from '../../../services/Knowledge/collectionService';
import { CollectionRole } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { RadioGroup, Radio } from '../../ui/RadioGroup/RadioGroup';

interface ChannelOption {
  id: string;
  name: string;
}

interface CreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  scopeType: string;
  scopeId?: string;
  channels: ChannelOption[];
  onSuccess: (collection: CollectionSummary) => void;
}

const FOCUS_DELAY_MS = 50;

const CreateCollectionModal = ({
  isOpen,
  onClose,
  scopeType,
  scopeId: initialScopeId,
  channels,
  onSuccess,
}: CreateCollectionModalProps): ReactElement => {
  const { user } = useAuth();
  const zero = useZero();
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(initialScopeId ?? null);

  const effectiveScopeId = selectedChannelId;

  const resetForm = useCallback(() => {
    setTitle('');
    setIsPrivate(false);
    setIsCreating(false);
    setSelectedChannelId(initialScopeId ?? null);
  }, [initialScopeId]);

  const handleClose = useCallback(() => {
    if (isCreating) return;
    resetForm();
    onClose();
  }, [isCreating, onClose, resetForm]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
      window.setTimeout(() => {
        nameInputRef.current?.focus();
      }, FOCUS_DELAY_MS);
    }
  }, [isOpen, resetForm]);

  const handleCreateCollection = useCallback(async () => {
    const finalTitle = title.trim();
    if (!finalTitle) return;
    if (!user) {
      toast.error('You must be logged in to create a collection');
      return;
    }

    setIsCreating(true);

    try {
      const id = crypto.randomUUID();
      const timestamp = Date.now();
      // No channel selected — the collection belongs to the whole workspace
      // instead of a single channel. 'WORKSPACE' is just another value for
      // the existing (non-nullable) scopeType/scopeId columns, not a schema
      // change; visibility then follows `isPrivate` same as channel-scoped
      // collections.
      const serverRes = await zero.mutate(
        mutators.collection.createCollection({
          id,
          scopeType: effectiveScopeId ? scopeType : 'WORKSPACE',
          scopeId: effectiveScopeId ?? user.workspaceId,
          name: finalTitle,
          description: null,
          isPrivate,
          permissionId: crypto.randomUUID(),
          timestamp,
        }),
      ).server;

      if (serverRes.type === 'error') {
        setIsCreating(false);
        const msg = serverRes.error.message || '';
        if (msg.includes('already exists')) {
          toast.error(msg);
        } else {
          toast.error(msg || 'Failed to create collection. Please try again.');
        }
        return;
      }

      const collection: CollectionSummary = {
        id,
        name: finalTitle,
        description: null,
        ownerId: user.id,
        canShare: true,
        role: CollectionRole.OWNER,
      };

      resetForm();
      onSuccess(collection);
      onClose();
    } catch (error) {
      setIsCreating(false);
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('already exists')) {
        toast.error(msg);
      } else {
        toast.error(msg || 'Failed to create collection. Please try again.');
      }
    }
  }, [zero, title, scopeType, effectiveScopeId, isPrivate, user, onSuccess, onClose, resetForm]);

  const canSubmit = title.trim().length > 0 && !isCreating;

  const channelOptions = useMemo(
    () =>
      channels.map(ch => ({
        value: ch.id,
        label: ch.name,
        icon: <Hash size={14} className='text-gray-500' />,
      })),
    [channels],
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Create Collection'
      description='Create a collection first. You can upload files or folders inside it next.'
      className='max-w-md bg-secondary border border-border'
    >
      <form
        className='p-4'
        onSubmit={event => {
          event.preventDefault();
          void handleCreateCollection();
        }}
      >
        <div className='space-y-3'>
          <div>
            <label className='block text-sm font-medium text-foreground mb-1' htmlFor='kb-name'>
              Collection name
            </label>
            <Input
              id='kb-name'
              ref={nameInputRef}
              type='text'
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder='e.g. Product docs'
              disabled={isCreating}
              data-track-category='knowledge-base'
              data-track-name='collection-name-input'
            />
          </div>

          {/* Channel selector (only if no initialScopeId provided). Optional —
              leaving it unset scopes the collection to the whole workspace
              instead of a single channel. */}
          {!initialScopeId && (
            <div>
              <div className='block text-sm font-medium text-foreground mb-1'>
                Channel <span className='text-muted-foreground font-normal'>(optional)</span>
              </div>
              <EntitySelector
                options={channelOptions}
                selectedValue={selectedChannelId}
                onSelect={setSelectedChannelId}
                placeholder='No channel — visible to the whole workspace'
                searchPlaceholder='Search channels...'
                width='100%'
                showClearButton
              />
            </div>
          )}

          <RadioGroup
            name='visibility'
            label='Visibility'
            value={isPrivate ? 'private' : 'public'}
            onChange={value => setIsPrivate(value === 'private')}
            disabled={isCreating}
          >
            <Radio
              value='public'
              subtext='Anyone in the workspace can view — editing requires an invite'
            >
              Public
            </Radio>
            <Radio value='private' subtext='Invite only'>
              Private
            </Radio>
          </RadioGroup>
        </div>

        {/* Submit Button */}
        <div className='flex justify-end gap-2 mt-3'>
          <Button
            type='submit'
            disabled={!canSubmit}
            loading={isCreating}
            className='px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            <Plus size={16} />
            Create Collection
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default CreateCollectionModal;
