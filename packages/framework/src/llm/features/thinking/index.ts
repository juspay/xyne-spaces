/**
 * Thinking and parameter optimization features
 */

export type {
  TaskType,
  TemperatureConfig,
  TaskDetectionResult
} from './temperature-manager.js';

export {
  TemperatureManager,
  createTemperatureManager,
  detectOptimalTemperature
} from './temperature-manager.js';