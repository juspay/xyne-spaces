import { Router } from 'express';
import { DashboardCrudController } from '@/controllers/dashboardCrudController';

const ctrl = new DashboardCrudController();

export const dashboardCrudRouter = Router();

dashboardCrudRouter.post('/queries', ctrl.upsertQuery);
dashboardCrudRouter.delete('/queries/:id', ctrl.deleteQuery);

// Tile/component writes keyed by query id.
dashboardCrudRouter.patch('/components/:queryId', ctrl.updateComponent);
dashboardCrudRouter.delete('/components/:queryId', ctrl.deleteComponent);

// Dashboards.
dashboardCrudRouter.get('/', ctrl.list);
dashboardCrudRouter.post('/', ctrl.create);
dashboardCrudRouter.post('/with-components', ctrl.createWithComponents);
dashboardCrudRouter.get('/:id', ctrl.getById);
dashboardCrudRouter.patch('/:id', ctrl.update);
dashboardCrudRouter.delete('/:id', ctrl.remove);

// Participants.
dashboardCrudRouter.get('/:id/participants', ctrl.listParticipants);
dashboardCrudRouter.post('/:id/participants', ctrl.addParticipants);
dashboardCrudRouter.patch('/:id/participants/:userId', ctrl.updateParticipantRole);
dashboardCrudRouter.delete('/:id/participants/:userId', ctrl.removeParticipant);

// Tiles scoped to a dashboard.
dashboardCrudRouter.post('/:id/components', ctrl.createComponent);
dashboardCrudRouter.patch('/:id/components/positions', ctrl.updatePositions);

// Reorder a dashboard's tiles/queries.
dashboardCrudRouter.patch('/:id/queries/reorder', ctrl.reorderQueries);
