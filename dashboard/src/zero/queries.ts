import { createBuilder } from '@rocicorp/zero';
import { schema } from '@xyne/shared';
export { queries } from '@xyne/shared/zero/queries';
export const zql = createBuilder(schema);
// Dashboard-specific: expose builder on window for debugging
window.__builder = zql;
