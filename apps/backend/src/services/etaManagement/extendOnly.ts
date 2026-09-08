import type { EtaUpdateDecision, ForecastResult } from './types';

/**
 * The one place automatic ETA math is ever applied: extend-only, never
 * shorten. Every mutation path must route its automatic due-date change
 * through this function instead of writing `calculateETADeadline`'s result
 * directly.
 */
export function decideEtaUpdate(currentEta: Date | null, forecast: ForecastResult): EtaUpdateDecision {
  if (forecast.status !== 'COMPLETE' || forecast.forecastEta === null) {
    return { newEta: currentEta, changed: false };
  }

  if (currentEta === null) {
    return { newEta: forecast.forecastEta, changed: true };
  }

  const newEta = forecast.forecastEta.getTime() > currentEta.getTime() ? forecast.forecastEta : currentEta;
  return { newEta, changed: newEta.getTime() !== currentEta.getTime() };
}
