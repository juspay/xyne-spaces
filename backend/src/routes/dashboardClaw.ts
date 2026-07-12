import { Router } from 'express';
import { dashboardClawController as ctrl } from '@/controllers/dashboardClawController';

// Tool endpoints for the dashboard-ai Claw agent (called by the
// xyne-dashboard MCP server, not by the browser). Mounted behind
// authenticateUserOrApp in app.ts.
export const dashboardClawRouter = Router()
  .post('/list-schema', ctrl.listSchema)
  .post('/get-table-schema', ctrl.getTableSchema)
  .post('/run-query', ctrl.runQuery)
  .post('/add-component', ctrl.addComponent)
  .post('/update-component', ctrl.updateComponent)
  .post('/remove-component', ctrl.removeComponent)
  .post('/set-meta', ctrl.setDashboardMeta)
  .post('/drill-result', ctrl.drillResult);
