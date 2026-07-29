// Polling configuration

export interface PollingConfig {
  minInterval: number
  maxInterval: number
  batchSize: number 
}

export const WORKFLOW_POLLER_CONFIG: PollingConfig = {
  minInterval: 60000,  // 1 minute when workflows are found
  maxInterval: 60000,  // 1 minute when idle
  batchSize: 5
}

export const EVENT_POLLER_CONFIG: PollingConfig = {
  minInterval: 60000,  // 1 minute when events are found
  maxInterval: 60000,  // 1 minute when idle
  batchSize: 5
}

export const DEFAULT_CONFIG: PollingConfig = WORKFLOW_POLLER_CONFIG