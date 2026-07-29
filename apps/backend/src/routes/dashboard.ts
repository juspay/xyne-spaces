import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { DashboardController } from '@/controllers/dashboardController';
import { authorize } from '@/middleware/authorize';

// Browser-facing dashboard API, one controller behind two mounts:
//   /api/dashboard   — data sources, query execution, AI chat stream
//   /api/dashboards  — dashboards/participants/tiles REST
// (The dashboard-ai agent's tool endpoints live separately in
// routes/dashboardClaw.ts — machine contract, different auth.)
const ctrl = new DashboardController();

const readDS = authorize('DATA_SOURCES', AccessType.READ);
const writeDS = authorize('DATA_SOURCES', AccessType.WRITE);

const datasource = Router()
  .get('/list',              readDS,  ctrl.dataSourcesList)
  .get('/config',            readDS,  ctrl.dataSourcesGetConfig)
  .post('/create',           writeDS, ctrl.dataSourcesCreate)
  .post('/test',             writeDS, ctrl.dataSourcesTest)
  .post('/discover-tables',  writeDS, ctrl.dataSourcesDiscoverTables)
  .get('/:id',               readDS,  ctrl.dataSourcesGetById)
  .get('/:id/schema',        readDS,  ctrl.dataSourcesGetSchema)
  .post('/:id/refresh',      writeDS, ctrl.dataSourcesRefresh)
  .delete('/:id',            writeDS, ctrl.dataSourcesRemove);

// /preview runs a caller-supplied query plan (editor action), so it needs the
// same DATA_SOURCES read grant as /datasource/* — otherwise any authenticated
// user could execute arbitrary plans without authorization to read the sources.
// /component/:id is the viewer path: it authorizes per-dashboard access inside
// the controller (userCanReadDashboard), so it deliberately does NOT gate on the
// DATA_SOURCES role — a dashboard viewer need not be a data-source editor.
const query = Router()
  .post('/preview',          readDS,  ctrl.queryPreview)
  .get('/component/:id',     ctrl.queryGetComponentData);

const ai = Router()
  .post('/create',           ctrl.aiCreate)
  .post('/cancel/:runId',    ctrl.aiCancel);

// Mounted at /api/dashboard
export const dashboardRouter = Router()
  .use('/datasource',  datasource)
  .use('/query',       query)
  .use('/ai',          ai);

// Mounted at /api/dashboards. Specific paths (components/:queryId,
// with-components) are registered before the '/:id' catch-alls.
export const dashboardCrudRouter = Router()
  // Tile/component writes keyed by query id.
  .patch('/components/:queryId',  ctrl.updateComponent)
  .delete('/components/:queryId', ctrl.deleteComponent)
  // Dashboards.
  .get('/',                 ctrl.list)
  .post('/',                ctrl.create)
  .post('/with-components', ctrl.createWithComponents)
  .get('/:id',              ctrl.getById)
  .patch('/:id',            ctrl.update)
  .delete('/:id',           ctrl.remove)
  // Participants.
  .get('/:id/participants',            ctrl.listParticipants)
  .post('/:id/participants',           ctrl.addParticipants)
  .patch('/:id/participants/:userId',  ctrl.updateParticipantRole)
  .delete('/:id/participants/:userId', ctrl.removeParticipant)
  // Tiles scoped to a dashboard.
  .post('/:id/components',             ctrl.createComponent)
  .patch('/:id/components/positions',  ctrl.updatePositions);
