import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { DynamicDashboardController } from '@/controllers/dynamicDashboardController';
import { authorize } from '@/middleware/authorize';

const ctrl = new DynamicDashboardController();
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

const query = Router()
  .post('/preview',          ctrl.queryPreview)
  .get('/component/:id',     ctrl.queryGetComponentData);

const ai = Router()
  .post('/create',           ctrl.aiCreate);

export const dashboardRouter = Router()
  .use('/datasource',  datasource)
  .use('/query',       query)
  .use('/ai',          ai);
