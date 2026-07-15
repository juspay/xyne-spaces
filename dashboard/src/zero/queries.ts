import { createBuilder } from '@rocicorp/zero';
import { schema } from '@xyne/shared';
export {
  queries,
  UNASSIGNED_FILTER_VALUE,
  ASSIGNEE_INVERT_MARKER,
  parseAssigneeFilter,
} from '@xyne/shared/zero/queries';
export const zql = createBuilder(schema);
// Dashboard-specific: expose builder on window for debugging
window.__builder = zql;
