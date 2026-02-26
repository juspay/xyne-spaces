// Core exports
export { BaseVespaHandler } from './core/base-handler';
export { VespaHandlerFactory } from './core/handler-factory';
export {
  createVespaJobsAccumulator,
  collectVespaJobs,
  getAccumulatedJobCount,
  clearAccumulator,
  type VespaOperation,
} from './core/collector';
export type {
  VespaJobType,
  VespaJobConfig,
  VespaJobsAccumulator,
  TableName,
} from './core/types';

// Table-specific handlers (for direct use if needed)
export { MessagesVespaHandler } from './tables/messages-handler';
export { TicketsVespaHandler } from './tables/tickets-handler';
export { ChannelsVespaHandler } from './tables/channels-handler';
export { ProjectsVespaHandler } from './tables/projects-handler';
export { RCAVespaHandler } from './tables/rca-handler';
