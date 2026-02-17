import { ReactElement, useEffect, useState, useMemo } from 'react';
import { useZero } from '../../../hooks/useZero';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Shield, X, Search, ChevronDown, Check } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUser } from '../../../hooks/useUsers';
import { AccessType } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';

interface ResourceAccessModalProps {
  userId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface Resource {
  id: string;
  name: string;
  description: string | null;
}

interface ResourceAccess {
  id: string;
  userId: string | null;
  resourceId: string;
  accessType: AccessType;
}

const accessTypeOptions = [
  { label: 'No Access', value: 'NONE' },
  { label: 'Read', value: AccessType.READ },
  { label: 'Write', value: AccessType.WRITE },
  { label: 'Admin', value: AccessType.ADMIN },
];

export const ResourceAccessModal = ({
  userId,
  isOpen,
  onClose,
}: ResourceAccessModalProps): ReactElement => {
  const zero = useZero();
  const selectedUser = useUser(userId ?? '');

  // Fetch all resources
  const [resources] = useCachedQuery(queries.getAllResources());

  // Fetch user's current access for all resources
  const [userAccess] = useCachedQuery(queries.getResourceAccessForUser({ userId: userId ?? '' }));

  // Local state for access changes
  const [accessState, setAccessState] = useState<Record<string, AccessType | 'NONE'>>({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Get user info from XState
  const userName = selectedUser?.name ?? '';
  const userEmail = selectedUser?.email ?? '';

  // Initialize access state from current user access
  useEffect(() => {
    if (resources && userAccess) {
      const initialState: Record<string, AccessType | 'NONE'> = {};
      resources.forEach((resource: Resource) => {
        const access = userAccess.find((a: ResourceAccess) => a.resourceId === resource.id);
        initialState[resource.id] = access ? access.accessType : 'NONE';
      });
      setAccessState(initialState);
    }
  }, [resources, userAccess]);

  // Filter resources based on search
  const filteredResources = useMemo(() => {
    if (!resources) return [];
    if (!searchTerm.trim()) return resources;
    const searchLower = searchTerm.toLowerCase();
    return resources.filter(
      (resource: Resource) =>
        resource.name.toLowerCase().includes(searchLower) ||
        (resource.description && resource.description.toLowerCase().includes(searchLower)),
    );
  }, [resources, searchTerm]);

  const handleAccessChange = (resourceId: string, newAccess: AccessType | 'NONE'): void => {
    setAccessState(prev => ({
      ...prev,
      [resourceId]: newAccess,
    }));
  };

  const handleSave = async (): Promise<void> => {
    if (!userId) return;

    setLoading(true);
    try {
      const timestamp = Date.now();

      // Collect all changes
      const grants: Array<{
        id: string;
        userId: string;
        resourceId: string;
        accessType: AccessType;
      }> = [];
      const revokeIds: string[] = [];
      const updates: Array<{ id: string; accessType: AccessType }> = [];

      for (const resource of (resources || []) as Resource[]) {
        const resourceId = resource.id;
        const newAccess = accessState[resourceId];
        const currentAccess = (userAccess || []).find(
          (a: ResourceAccess) => a.resourceId === resourceId,
        );

        // If access changed
        if (newAccess === 'NONE' && currentAccess) {
          revokeIds.push(currentAccess.id);
        } else if (newAccess !== 'NONE' && !currentAccess) {
          grants.push({
            id: uuidv4(),
            userId,
            resourceId,
            accessType: newAccess as AccessType,
          });
        } else if (
          newAccess !== 'NONE' &&
          currentAccess &&
          newAccess !== currentAccess.accessType
        ) {
          updates.push({
            id: currentAccess.id,
            accessType: newAccess as AccessType,
          });
        }
      }

      // Execute bulk operations
      if (revokeIds.length > 0) {
        const result = zero.mutate(mutators.resourceAccess.revoke({ ids: revokeIds }));
        const res = await result.server;
        if (res.type === 'error') {
          toast.error('Revoke Failed', {
            description: `Failed to revoke access: ${res.error.message}`,
            duration: 5000,
          });
          setLoading(false);
          return;
        }
      }

      if (grants.length > 0) {
        const result = zero.mutate(mutators.resourceAccess.grant({ grants, timestamp }));
        const res = await result.server;
        if (res.type === 'error') {
          toast.error('Grant Failed', {
            description: `Failed to grant access: ${res.error.message}`,
            duration: 5000,
          });
          setLoading(false);
          return;
        }
      }

      if (updates.length > 0) {
        const result = zero.mutate(mutators.resourceAccess.update({ updates, timestamp }));
        const res = await result.server;
        if (res.type === 'error') {
          toast.error('Update Failed', {
            description: `Failed to update access: ${res.error.message}`,
            duration: 5000,
          });
          setLoading(false);
          return;
        }
      }

      toast.success('Access Updated', {
        description: 'Resource access has been successfully updated',
        duration: 3000,
      });
      onClose();
    } catch (error) {
      toast.error('Error', {
        description: error instanceof Error ? error.message : 'Failed to update access',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !userId) return <></>;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-white rounded-lg shadow-xl w-full max-w-2xl h-[800px] max-h-[90vh] flex flex-col'>
        {/* Header */}
        <div className='px-6 py-4 border-b border-gray-200 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div className='w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center'>
              <Shield className='w-5 h-5 text-primary' />
            </div>
            <div>
              <h2 className='text-lg font-semibold text-gray-900'>Manage Resource Access</h2>
              <p className='text-sm text-gray-500'>{userName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className='p-2 hover:bg-gray-100 rounded-lg transition-colors'
            aria-label='Close'
          >
            <X className='w-5 h-5 text-gray-500' />
          </button>
        </div>

        {/* User Info Card */}
        <div className='px-6 py-4 bg-gray-50 border-b border-gray-200'>
          <div className='flex items-center gap-3'>
            <Avatar userId={userId} size='md' />
            <div>
              <p className='font-medium text-gray-900'>{userName}</p>
              <p className='text-sm text-gray-500'>{userEmail}</p>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className='px-6 py-3 border-b border-gray-200 bg-gray-50'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400 pointer-events-none z-10' />
            <Input
              type='text'
              placeholder='Search resources...'
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className='w-full pl-10 pr-4 h-9 text-sm'
            />
          </div>
        </div>

        {/* Resources List */}
        <div className='flex-1 overflow-y-auto'>
          {resources && resources.length === 0 ? (
            <div className='text-center py-8'>
              <p className='text-sm text-gray-500'>No resources found</p>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className='text-center py-8 px-4'>
              <p className='text-sm text-gray-500'>{`No resources found for "${searchTerm}"`}</p>
            </div>
          ) : (
            <div className='divide-y divide-gray-100'>
              {filteredResources.map((resource: Resource) => (
                <div
                  key={resource.id}
                  className='flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition-colors'
                >
                  <div className='flex-1 min-w-0 pr-4'>
                    <span className='text-sm font-medium text-gray-900'>{resource.name}</span>
                    {resource.description && (
                      <p className='text-xs text-gray-500 mt-0.5 truncate'>
                        {resource.description}
                      </p>
                    )}
                  </div>
                  <div className='w-[140px] shrink-0'>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-7 w-full justify-between text-xs'
                          disabled={loading}
                        >
                          <span className='truncate'>
                            {accessTypeOptions.find(
                              opt =>
                                String(opt.value) === String(accessState[resource.id] || 'NONE'),
                            )?.label || 'Access'}
                          </span>
                          <ChevronDown className='ml-1 h-3 w-3 shrink-0 opacity-50' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='start' className='w-[140px]'>
                        {accessTypeOptions.map(option => (
                          <DropdownMenuItem
                            key={option.value}
                            onClick={() =>
                              handleAccessChange(resource.id, option.value as AccessType | 'NONE')
                            }
                            className='text-xs'
                          >
                            <span className='flex-1'>{option.label}</span>
                            {String(accessState[resource.id] || 'NONE') ===
                              String(option.value) && <Check className='h-3 w-3' />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='border-t border-gray-200 p-6 flex gap-3 justify-end bg-white'>
          <Button variant='outline' onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={loading}>
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
};
