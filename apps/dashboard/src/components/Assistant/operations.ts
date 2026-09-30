import type { ActionDefinition, PlanStep } from './actions/action';
import { APP_DIALOGS, APP_PAGES } from './pages';

type OperationDeps = {
  navigate: (path: string) => void;
  workspaceBase: string;
};

type Operations = {
  [Op in PlanStep['op']]: (step: Extract<PlanStep, { op: Op }>, deps: OperationDeps) => void;
};

const OPERATIONS: Operations = {
  open_page: (step, deps) => {
    deps.navigate(`${deps.workspaceBase}/${APP_PAGES[step.page].path}`);
  },
  open_dialog: (step, deps) => {
    deps.navigate(`${deps.workspaceBase}/${APP_DIALOGS[step.dialog].path}`);
  },
};

export const runPlan = (action: ActionDefinition, deps: OperationDeps): void => {
  for (const step of action.plan) {
    const run = OPERATIONS[step.op] as (step: PlanStep, deps: OperationDeps) => void;
    run(step, deps);
  }
};
