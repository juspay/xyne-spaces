import { ReactElement, useState, useMemo } from 'react';
import { Building2, Plus, X, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { useSelf } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import Dialog from '../../components/ui/Dialog';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { v4 as uuidv4 } from 'uuid';

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement => (
  <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
    {children}
  </div>
);

export const OrganizationsTab = (): ReactElement => {
  const self = useSelf();
  const z = useZero();
  const workspaceId = self?.workspaceId;

  const [linkedOrgs] = useCachedQuery(
    queries.workspaceOrganizations({ workspaceId: workspaceId || '' }),
    { enabled: !!workspaceId },
  );
  const [allOrgs] = useCachedQuery(queries.availableOrganizations({}), { enabled: true });

  const availableOrgs = useMemo(() => {
    if (!allOrgs || !linkedOrgs) return [];
    const linkedOrgIds = new Set(linkedOrgs.map(lo => lo.orgId));
    return allOrgs.filter(org => !linkedOrgIds.has(org.orgId));
  }, [allOrgs, linkedOrgs]);

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [removingOrgId, setRemovingOrgId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [orgToRemove, setOrgToRemove] = useState<{ orgId: string; name: string } | null>(null);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgDescription, setNewOrgDescription] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);

  // Format available orgs for EntitySelector
  const orgOptions = useMemo(() => {
    if (!availableOrgs) return [];
    return availableOrgs.map(org => ({
      value: org.orgId,
      label: org.name,
      icon: <Building2 className='w-4 h-4 text-muted-foreground' />,
      subtitle: org.description || '',
    }));
  }, [availableOrgs]);

  const handleAddOrg = (): void => {
    if (!workspaceId || !selectedOrgId) return;

    z.mutate(
      mutators.workspaceOrg.add({
        workspaceId,
        orgId: selectedOrgId,
        id: uuidv4(),
        timestamp: Date.now(),
      }),
    );
    toast.success('Organization added successfully');
    setSelectedOrgId(null);
  };

  const handleRemoveOrg = (orgId: string, orgName: string): void => {
    if (!workspaceId) return;

    setOrgToRemove({ orgId, name: orgName });
    setShowRemoveDialog(true);
  };

  const confirmRemoveOrg = (): void => {
    if (!workspaceId || !orgToRemove) return;

    setRemovingOrgId(orgToRemove.orgId);
    z.mutate(
      mutators.workspaceOrg.remove({
        workspaceId,
        orgId: orgToRemove.orgId,
        timestamp: Date.now(),
      }),
    );
    toast.success('Organization removed successfully');
    setRemovingOrgId(null);
    setShowRemoveDialog(false);
    setOrgToRemove(null);
  };

  const handleCreateOrg = (): void => {
    if (!workspaceId || !newOrgName.trim()) {
      toast.error('Organization name is required');
      return;
    }

    setIsCreatingOrg(true);
    const orgId = uuidv4();
    const workspaceOrgId = uuidv4();
    const memberId = uuidv4();

    z.mutate(
      mutators.org.create({
        orgId,
        orgName: newOrgName.trim(),
        orgDescription: newOrgDescription.trim() || undefined,
        workspaceId,
        workspaceOrgId,
        memberId,
        creatorEmail: self?.email ?? '',
        timestamp: Date.now(),
      }),
    );

    toast.success('Organization created and added successfully');
    setNewOrgName('');
    setNewOrgDescription('');
    setShowCreateDialog(false);
    setIsCreatingOrg(false);
  };

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center'>
          <Building2 className='w-5 h-5 text-primary' />
        </div>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Linked Organizations</h2>
          <p className='text-sm text-muted-foreground'>
            Manage organizations connected to this workspace
          </p>
        </div>
      </div>

      {/* Add Organization */}
      <div className='space-y-4'>
        <div className='flex gap-3 items-center'>
          <h3 className='text-sm font-medium text-foreground flex-1'>Link New Organization</h3>
          <Button
            onClick={() => setShowCreateDialog(true)}
            data-track-category='workspace-management'
            data-track-name='OPEN_CREATE_ORG_DIALOG'
            variant='outline'
            className='gap-2'
          >
            <Plus className='w-4 h-4' />
            Create New
          </Button>
        </div>

        {/* Create Organization Dialog */}
        <Dialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          className='max-w-md rounded-xl'
        >
          <div className='p-6 space-y-4'>
            {/* Header */}
            <div className='flex items-center justify-between'>
              <div>
                <h2 className='text-lg font-semibold text-foreground'>Create Organization</h2>
                <p className='text-sm text-muted-foreground mt-1'>
                  You&apos;ll automatically become the admin
                </p>
              </div>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setShowCreateDialog(false)}
                data-track-category='workspace-management'
                data-track-name='CLOSE_CREATE_ORG_DIALOG'
                className='size-7 p-0 text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted'
                disabled={isCreatingOrg}
              >
                <X className='size-4' />
              </Button>
            </div>

            {/* Organization Name */}
            <div className='space-y-2'>
              <label htmlFor='org-name' className='text-sm font-medium text-foreground'>
                Organization Name <span className='text-destructive'>*</span>
              </label>
              <Input
                id='org-name'
                type='text'
                placeholder='Enter organization name...'
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                disabled={isCreatingOrg}
              />
            </div>

            {/* Organization Description */}
            <div className='space-y-2'>
              <label htmlFor='org-description' className='text-sm font-medium text-foreground'>
                Description
              </label>
              <textarea
                data-track-category='workspace-management'
                data-track-name='org-description-input'
                id='org-description'
                placeholder='A brief description of your organization...'
                value={newOrgDescription}
                onChange={e => setNewOrgDescription(e.target.value)}
                disabled={isCreatingOrg}
                rows={3}
                className={cn(
                  'w-full px-3 py-2 rounded-md border border-input bg-background',
                  'text-sm text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring',
                  'resize-none disabled:opacity-50',
                )}
              />
            </div>

            {/* Action Buttons */}
            <div className='flex gap-3 justify-end pt-2'>
              <Button
                variant='outline'
                disabled={isCreatingOrg}
                onClick={() => setShowCreateDialog(false)}
                data-track-category='workspace-management'
                data-track-name='CANCEL_CREATE_ORG'
                size='sm'
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateOrg}
                data-track-category='workspace-management'
                data-track-name='CREATE_ORG'
                disabled={!newOrgName.trim() || isCreatingOrg}
                className='gap-2'
                size='sm'
              >
                {isCreatingOrg ? (
                  <>
                    <Loader2 className='size-4 animate-spin' />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className='size-4' />
                    Create
                  </>
                )}
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Link Organization Card */}
        <Card className='p-6'>
          <div className='flex gap-3 items-start'>
            <div className='flex-1'>
              <EntitySelector
                options={orgOptions}
                selectedValue={selectedOrgId}
                onSelect={setSelectedOrgId}
                placeholder='Select an organization...'
                searchPlaceholder='Search organizations...'
                width='100%'
              />
            </div>
            <Button
              onClick={handleAddOrg}
              data-track-category='workspace-management'
              data-track-name='ADD_ORG_TO_WORKSPACE'
              disabled={!selectedOrgId}
              className='gap-2'
            >
              <Plus className='w-4 h-4' />
              Add
            </Button>
          </div>
          {orgOptions.length === 0 && (
            <p className='text-sm text-muted-foreground mt-2'>
              No available organizations to link. All active organizations are already linked to
              this workspace.
            </p>
          )}
        </Card>
      </div>

      {/* Linked Organizations List */}
      <Card>
        {!linkedOrgs || linkedOrgs.length === 0 ? (
          <div className='p-8 text-center text-muted-foreground'>
            <Building2 className='w-12 h-12 mx-auto mb-3 opacity-50' />
            <p>No organizations linked</p>
            <p className='text-sm mt-1'>Link organizations to allow their members to join</p>
          </div>
        ) : (
          <div className='divide-y divide-border'>
            {linkedOrgs.map(linkedOrg => {
              const org = linkedOrg.organization;
              if (!org) return null;

              return (
                <div
                  key={linkedOrg.id}
                  className='flex items-center justify-between p-4 hover:bg-muted/50 transition-colors'
                >
                  <div className='flex items-center gap-3'>
                    <div className='w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center'>
                      <Building2 className='w-5 h-5 text-primary' />
                    </div>
                    <div>
                      <p className='font-medium text-foreground'>{org.name}</p>
                      {org.description && (
                        <p className='text-sm text-muted-foreground'>{org.description}</p>
                      )}
                      <p className='text-xs text-muted-foreground mt-0.5'>
                        Linked {new Date(linkedOrg.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => handleRemoveOrg(org.orgId, org.name)}
                    data-track-category='workspace-management'
                    data-track-name='OPEN_REMOVE_ORG_CONFIRM'
                    disabled={removingOrgId === org.orgId}
                    className='text-destructive hover:text-destructive hover:bg-destructive/10'
                  >
                    {removingOrgId === org.orgId ? (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    ) : (
                      <X className='w-4 h-4' />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Info */}
      <Card className='p-6 bg-muted/50 border-dashed'>
        <div className='space-y-2'>
          <h3 className='font-medium text-foreground'>About Organization Links</h3>
          <ul className='text-sm text-muted-foreground space-y-1 list-disc list-inside'>
            <li>Linking an organization allows its members to join this workspace</li>
            <li>Members must still be invited or have appropriate permissions</li>
            <li>Unlinking an organization does not remove existing members</li>
            <li>Only ACTIVE organizations can be linked to a workspace</li>
          </ul>
        </div>
      </Card>

      {/* Remove Organization Confirmation Dialog */}
      <Dialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        className='max-w-md rounded-xl'
      >
        <div className='p-6 space-y-4'>
          <div className='flex items-center gap-3'>
            <div className='w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center'>
              <AlertTriangle className='w-5 h-5 text-destructive' />
            </div>
            <h2 className='text-lg font-semibold text-foreground'>Remove Organization</h2>
          </div>

          <p className='text-sm text-muted-foreground'>
            Are you sure you want to remove{' '}
            <span className='font-medium text-foreground'>{orgToRemove?.name}</span> from this
            workspace?
          </p>
          <p className='text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg'>
            Note: This will not remove existing members, but new members from this organization will
            no longer be able to join automatically.
          </p>

          <div className='flex gap-3 justify-end pt-2'>
            <Button
              variant='outline'
              onClick={() => {
                setShowRemoveDialog(false);
                setOrgToRemove(null);
              }}
              data-track-category='workspace-management'
              data-track-name='CANCEL_REMOVE_ORG'
              disabled={removingOrgId === orgToRemove?.orgId}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmRemoveOrg}
              data-track-category='workspace-management'
              data-track-name='CONFIRM_REMOVE_ORG'
              disabled={removingOrgId === orgToRemove?.orgId}
              className='gap-2'
            >
              {removingOrgId === orgToRemove?.orgId ? (
                <Loader2 className='w-4 h-4 animate-spin' />
              ) : null}
              Remove
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default OrganizationsTab;
