import { ReactElement, useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button/Button';
import { AppsTable } from '../../components/Apps/AppsTable/AppsTable';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import CreateAppForm from '../../components/Apps/CreateAppForm/CreateAppForm';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { useMutation } from '@tanstack/react-query';
import { appsService } from '../../services/Apps/appsService';
import { mutators } from '../../zero/mutators';
import { toast } from 'sonner';
import { Plus, AppWindow, ChevronLeft, ChevronRight } from 'lucide-react';

const ITEMS_PER_PAGE = 15;

const AppsScreen = (): ReactElement => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const zero = useZero();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const cursorHistoryRef = useRef<{ createdAt: number; id: string }[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem('appsCursorHistory');
    if (!stored) return;
    try {
      cursorHistoryRef.current = JSON.parse(stored) as { createdAt: number; id: string }[];
    } catch {
      cursorHistoryRef.current = [];
    }
  }, []);

  const startCursor = useMemo(() => {
    if (currentPage <= 1) return null;
    const stored = sessionStorage.getItem('appsCursorHistory');
    if (!stored) return null;

    try {
      const history = JSON.parse(stored) as { createdAt: number; id: string }[];
      return history[currentPage - 2] ?? null;
    } catch {
      return null;
    }
  }, [currentPage]);

  const [apps] = useCachedQuery(
    queries.getAllAppsPaginated({
      limit: ITEMS_PER_PAGE,
      start: startCursor,
    }),
  );

  const hasNextPage = (apps?.length ?? 0) === ITEMS_PER_PAGE;
  const hasPreviousPage = currentPage > 1;

  const handleNextPage = () => {
    if (hasNextPage && apps && apps.length > 0) {
      const lastApp = apps[apps.length - 1];
      if (lastApp) {
        cursorHistoryRef.current[currentPage - 1] = {
          createdAt: lastApp.createdAt,
          id: lastApp.id,
        };
        sessionStorage.setItem('appsCursorHistory', JSON.stringify(cursorHistoryRef.current));
      }
      setSearchParams(prev => {
        prev.set('page', String(currentPage + 1));
        return prev;
      });
    }
  };

  const handlePreviousPage = () => {
    if (hasPreviousPage) {
      setSearchParams(prev => {
        prev.set('page', String(currentPage - 1));
        return prev;
      });
    }
  };

  // Check if user has READ-only access
  const appAccessLevel = permissions
    .filter(p => p.resourceName === 'XYNE-APPS')
    .map(p => p.accessType)[0];

  const canCreateApp = appAccessLevel === 'WRITE' || appAccessLevel === 'ADMIN';

  // Install app mutation
  const installAppMutation = useMutation({
    mutationFn: async (appId: string) => {
      return appsService.installApp(appId);
    },
    onSuccess: () => {
      toast.success('App installed successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to install app', {
        description: error.message,
      });
    },
  });

  const handleUpdateApp = async (
    appId: string,
    data: { name?: string; description?: string; webhookUrl?: string },
  ): Promise<void> => {
    const mutatorPayload = {
      appId,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
      timestamp: Date.now(),
    };

    const result = zero.mutate(mutators.apps.update(mutatorPayload));
    const res = await result.server;

    if (res.type === 'error') {
      toast.error('Failed to update app', {
        description: res.error.message || 'Failed to update app',
        duration: 5000,
      });
      throw new Error(res.error.message || 'Failed to update app');
    }
  };

  const handleInstallApp = (appId: string): void => {
    installAppMutation.mutate(appId);
  };

  // Get JWT mutation
  const getJwtMutation = useMutation({
    mutationFn: async (appId: string): Promise<string> => {
      const response = await appsService.regenerateJwt(appId);
      return response.jwtToken;
    },
  });

  const getJwtToken = async (appId: string): Promise<string> => {
    return getJwtMutation.mutateAsync(appId);
  };

  // Upload picture mutation
  const uploadPictureMutation = useMutation({
    mutationFn: async ({ appId, file }: { appId: string; file: File }) => {
      return appsService.uploadBotPicture(appId, file);
    },
    onSuccess: () => {
      toast.success('Profile picture uploaded successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to upload profile picture', {
        description: error.message,
      });
    },
  });

  const handleUploadPicture = async (appId: string, file: File): Promise<void> => {
    await uploadPictureMutation.mutateAsync({ appId, file });
  };

  const loading = apps === undefined;

  if (loading) {
    return (
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div
      data-testid='apps-page'
      className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'
    >
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          <div className='flex items-center justify-between p-6 border-b border-border bg-background'>
            <div>
              <h2 className='text-lg font-bold text-foreground'>Xyne Apps</h2>
              <p className='text-xs text-muted-foreground mt-1'>
                Manage your xyne-apps and their configurations
              </p>
            </div>
            {canCreateApp && (
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                data-track-category='Apps'
                data-track-name='OpenCreateAppModal'
              >
                <Plus size={16} className='mr-1' />
                Create App
              </Button>
            )}
          </div>

          <Dialog
            open={isCreateModalOpen}
            onOpenChange={setIsCreateModalOpen}
            title='Create New App'
            description='Create a new xyne-app to integrate with your workspace'
            className='max-w-lg max-h-[85vh]'
          >
            <CreateAppForm
              onSuccess={() => setIsCreateModalOpen(false)}
              onCancel={() => setIsCreateModalOpen(false)}
            />
          </Dialog>

          <div className='flex-1 overflow-y-auto p-4'>
            {apps && apps.length > 0 ? (
              <AppsTable
                apps={apps}
                currentUserId={user?.id ?? ''}
                onInstall={handleInstallApp}
                onUpdateApp={handleUpdateApp}
                onGetJwtToken={getJwtToken}
                onUploadPicture={handleUploadPicture}
                userPermissions={permissions}
                isInstalling={installAppMutation.isPending}
              />
            ) : (
              <div className='text-center py-16'>
                <div className='text-muted-foreground text-5xl mb-4'>
                  <AppWindow size={48} className='mx-auto opacity-50' />
                </div>
                <h3 className='text-xl font-semibold text-foreground mb-2'>No apps yet</h3>
                <p className='text-muted-foreground'>Get started by creating your first xyne-app</p>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {(hasPreviousPage || hasNextPage) && (
            <div className='flex items-center justify-between px-6 py-3 border-t border-border bg-muted'>
              <Button
                variant='outline'
                size='sm'
                onClick={handlePreviousPage}
                disabled={!hasPreviousPage}
                className='gap-1'
              >
                <ChevronLeft className='h-4 w-4' />
                Prev
              </Button>
              <span className='text-sm text-muted-foreground'>Page {currentPage}</span>
              <Button
                variant='outline'
                size='sm'
                onClick={handleNextPage}
                disabled={!hasNextPage}
                className='gap-1'
              >
                Next
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

AppsScreen.displayName = 'AppsScreen';

export default AppsScreen;
