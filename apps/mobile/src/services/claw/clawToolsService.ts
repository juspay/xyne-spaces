import { clawApiRequest } from './clawRequest';
import type { AvailableTools } from './clawToolsTypes';

export const getAvailableTools = (): Promise<AvailableTools> =>
  clawApiRequest<AvailableTools>('/tools/available');
