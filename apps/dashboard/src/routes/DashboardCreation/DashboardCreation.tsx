import React, { useMemo, useState } from 'react';
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
import { useUsers } from '../../hooks/useUsers';

export const DashboardCreation: React.FC = () => {
  const zero = useZero();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const [formData, setFormData] = useState({ name: '', description: '' });

  const [dashboards] = useCachedQuery(queries.getAllDashboards());

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
        description: formData.description ? formData.description.trim() : undefined,
        createdBy: user?.id || '',
        timestamp: Date.now(),
      }),
    );
    void navigate(`/xyne-dashboards/${dashboardId}`);
  };

  const handleSelectDashboard = (dashboard: DashboardType): void => {
    void navigate(`/xyne-dashboards/${dashboard.id}`);
  };

  const handleDeleteDashboard = (dashboardId: string): void => {
    void zero.mutate(mutators.dashboard.delete({ id: dashboardId }));
  };

  const allUsers = useUsers();
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  // Zero syncs only dashboards the user owns or that are shared with them.
  const { mine, shared } = useMemo(() => {
    const list = dashboards ?? [];
    return {
      mine: list.filter(d => d.createdBy === user?.id),
      shared: list.filter(d => d.createdBy !== user?.id),
    };
  }, [dashboards, user?.id]);
  const dashboardList = dashboards ?? [];

  const renderCard = (dashboard: DashboardType, isOwn: boolean): React.ReactElement => (
    <div key={dashboard.id} className='p-4 bg-muted rounded-lg hover:bg-muted transition-colors'>
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
        {/* Only the owner can delete a dashboard. */}
        {isOwn && (
          <button
            aria-label={`Delete ${dashboard.name}`}
            onClick={() => void handleDeleteDashboard(dashboard.id)}
            className='p-1 text-muted-foreground hover:text-red-500'
            data-track-category='Dashboards'
            data-track-name='DeleteDashboard'
            data-track-metadata={JSON.stringify({ dashboardId: dashboard.id })}
          >
            <Trash2 className='w-4 h-4' />
          </button>
        )}
      </div>
      <p className='text-sm text-muted-foreground mb-1'>
        {dashboard.description || 'No description'}
      </p>
      {!isOwn && (
        <p className='text-xs text-muted-foreground mb-3'>
          Owner: {usersById.get(dashboard.createdBy)?.name ?? 'Unknown user'}
        </p>
      )}
      <button
        onClick={() => handleSelectDashboard(dashboard)}
        className='text-sm text-blue-600 hover:text-blue-800 mt-2'
        data-track-category='Dashboards'
        data-track-name='OpenDashboard'
        data-track-metadata={JSON.stringify({ dashboardId: dashboard.id })}
      >
        Open Dashboard →
      </button>
    </div>
  );

  const renderSection = (
    title: string,
    items: DashboardType[],
    isOwn: boolean,
    dotClass: string,
  ): React.ReactElement | null =>
    items.length === 0 ? null : (
      <section className='space-y-4'>
        <h3 className='text-md font-medium text-foreground mb-3 flex items-center gap-2'>
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          {title}
          <span className='text-sm text-muted-foreground font-normal'>
            ({items.length} dashboard{items.length !== 1 ? 's' : ''})
          </span>
        </h3>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
          {items.map(d => renderCard(d, isOwn))}
        </div>
      </section>
    );

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
      <div className='flex-1 overflow-auto p-6'>
        {dashboardList.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-64 text-center'>
            <div className='bg-muted p-4 rounded-full mb-4'>
              <LayoutDashboard className='w-12 h-12 text-muted-foreground' />
            </div>
            <h3 className='text-lg font-medium text-foreground mb-2'>No dashboards yet</h3>
            <p className='text-muted-foreground'>
              Create a dashboard, or ask a teammate to share one with you
            </p>
          </div>
        ) : (
          <div className='space-y-8'>
            {renderSection('My dashboards', mine, true, 'bg-blue-500')}
            {renderSection('Shared with me', shared, false, 'bg-green-500')}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(DashboardCreation);
