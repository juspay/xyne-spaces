import React, { useCallback, useState } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { LayoutDashboard, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import Input from '../../components/ui/Input/Input';
import Textarea from '../../components/ui/Textarea';
import type { Dashboard as DashboardType } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useCachedQuery } from '../../../src/hooks/useCachedQuery';
import { usePlatform } from '../../hooks/usePlatform';

export const DashboardCreation: React.FC = () => {
  const zero = useZero();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const [formData, setFormData] = useState({ name: '', description: '' });

  // Growing-limit window — the grid virtualizes (only visible cards render)
  // and grows the limit when the user scrolls to the bottom. One live
  // reactive query, no manual cursor accumulation.
  const PAGE_SIZE = 50;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [dashboards] = useCachedQuery(queries.allDashboards({ limit }));
  const dashboardList = (dashboards ?? []) as DashboardType[];
  const handleEndReached = useCallback(() => {
    if (dashboardList.length >= limit) setLimit(l => l + PAGE_SIZE);
  }, [dashboardList.length, limit]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCreateDashboard = (): void => {
    if (!formData.name.trim()) return;
    const dashboardId = uuidv4();
    void zero.mutate(
      mutators.dashboard.upsert({
        id: dashboardId,
        name: formData.name,
        description: formData.description || undefined,
        createdBy: user?.id || '',
        timestamp: Date.now(),
      }),
    );
    void navigate(`/analytics-dashboard/${dashboardId}`);
  };

  const handleSelectDashboard = (dashboard: DashboardType): void => {
    void navigate(`/analytics-dashboard/${dashboard.id}`);
  };

  const handleDeleteDashboard = (dashboardId: string): void => {
    void zero.mutate(mutators.dashboard.delete({ id: dashboardId }));
  };

  return (
    <div className='flex h-full bg-background md:rounded-2xl shadow-sm overflow-hidden'>
      {/* Left Panel - Create Dashboard Form */}
      <div className='w-80 border-r border-border bg-muted flex flex-col'>
        <div className='p-4 border-b border-border'>
          <h2 className='text-lg font-semibold text-foreground'>Create Dashboard</h2>
        </div>
        <div className='flex-1 overflow-auto p-4'>
          <div className='space-y-4'>
            <div>
              <label htmlFor='name' className='block text-sm font-medium text-foreground mb-1'>
                Name *
              </label>
              <Input
                id='name'
                name='name'
                type='text'
                value={formData.name}
                onChange={handleInputChange}
                placeholder='Enter dashboard name'
                autoFocus={!isMobile}
              />
            </div>
            <div>
              <label
                htmlFor='description'
                className='block text-sm font-medium text-foreground mb-1'
              >
                Description
              </label>
              <Textarea
                id='description'
                name='description'
                value={formData.description}
                onChange={handleInputChange}
                placeholder='Enter description (optional)'
                rows={3}
              />
            </div>
            <Button
              onClick={() => void handleCreateDashboard()}
              disabled={!formData.name.trim()}
              className='w-full'
              data-track-category='Dashboards'
              data-track-name='CreateDashboard'
            >
              <LayoutDashboard className='w-4 h-4' />
              Create Dashboard
            </Button>
          </div>
        </div>
      </div>

      {/* Right Panel - Dashboards List */}
      <div className='flex-1 min-h-0 flex flex-col p-6'>
        {dashboardList.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-64 text-center'>
            <div className='bg-muted p-4 rounded-full mb-4'>
              <LayoutDashboard className='w-12 h-12 text-muted-foreground' />
            </div>
            <h3 className='text-lg font-medium text-foreground mb-2'>No Dashboards Created</h3>
            <p className='text-muted-foreground'>
              Create your first dashboard to start building queries
            </p>
          </div>
        ) : (
          <>
            <h3 className='text-md font-medium text-foreground mb-3 flex items-center gap-2'>
              <span className='w-2 h-2 bg-blue-500 rounded-full' />
              All Dashboards
              <span className='text-sm text-muted-foreground font-normal'>
                ({dashboardList.length} dashboard{dashboardList.length !== 1 ? 's' : ''})
              </span>
            </h3>
            <div className='flex-1 min-h-0'>
              <VirtuosoGrid
                style={{ height: '100%' }}
                data={dashboardList}
                endReached={handleEndReached}
                listClassName='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
                itemContent={(_index, dashboard) => (
                  <div className='p-4 bg-muted rounded-lg hover:bg-muted transition-colors'>
                    <div className='flex items-start justify-between mb-2'>
                      <button
                        onClick={() => handleSelectDashboard(dashboard)}
                        className='flex-1 text-left'
                        data-track-category='Dashboards'
                        data-track-name='SelectDashboard'
                        data-track-metadata={JSON.stringify({
                          dashboardId: dashboard.id,
                          dashboardName: dashboard.name,
                        })}
                      >
                        <h3 className='text-md font-medium text-foreground'>{dashboard.name}</h3>
                      </button>
                      <button
                        onClick={() => void handleDeleteDashboard(dashboard.id)}
                        className='p-1 text-muted-foreground hover:text-red-500'
                        data-track-category='Dashboards'
                        data-track-name='DeleteDashboard'
                        data-track-metadata={JSON.stringify({ dashboardId: dashboard.id })}
                      >
                        <Trash2 className='w-4 h-4' />
                      </button>
                    </div>
                    <p className='text-sm text-muted-foreground mb-3'>
                      {dashboard.description || 'No description'}
                    </p>
                    <button
                      onClick={() => handleSelectDashboard(dashboard)}
                      className='text-sm text-blue-600 hover:text-blue-800'
                      data-track-category='Dashboards'
                      data-track-name='OpenDashboard'
                      data-track-metadata={JSON.stringify({ dashboardId: dashboard.id })}
                    >
                      Open Dashboard →
                    </button>
                  </div>
                )}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(DashboardCreation);
