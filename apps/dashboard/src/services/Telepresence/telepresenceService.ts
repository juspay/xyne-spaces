import type {
  TelepresenceHealthResponse,
  TelepresenceTimeseriesParams,
  TelepresenceTimeseriesResponse,
} from '../../types/telepresence';
import { apiInstance } from '../clients/apiClient';

// The telepresence-monitoring API (base path /api/telepresence-monitoring):
//   GET /health            — current snapshot per room (session-authenticated,
//                             CAC allow-listed via requireTelepresenceMonitoringCacAccess)
//   GET /health/timeseries — history log within a range (same auth)
//
// POST /health is the x-s2s-key device-ingestion endpoint and is never called
// from the browser: the browser has no s2s key, and polling it would mean
// submitting fabricated device reports.

// The documented API has no per-user allow-list of its own (401 = no/invalid
// session, not "not entitled"). Telepresence Observance access is gated in this
// app via TELEPRESENCE_ANALYTICS_ALLOWED_EMAILS: the nav item and route are
// hidden client-side, and queries are only enabled for allow-listed users. The
// backend enforces the same intent server-side via a CAC allow-list, so a 403
// here is treated as an access error and routes to the "access restricted" view.
export const isTelepresenceAccessError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'response' in error &&
    (error as { response?: { status?: number } }).response?.status === 403,
  );

class TelepresenceService {
  async getHealth(userId?: string): Promise<TelepresenceHealthResponse> {
    const response = await apiInstance.get<TelepresenceHealthResponse>(
      '/telepresence-monitoring/health',
      { params: userId ? { userId } : undefined },
    );
    return response.data;
  }

  async getTimeseries(
    params: TelepresenceTimeseriesParams,
  ): Promise<TelepresenceTimeseriesResponse> {
    const response = await apiInstance.get<TelepresenceTimeseriesResponse>(
      '/telepresence-monitoring/health/timeseries',
      { params },
    );
    return response.data;
  }
}

export const telepresenceService = new TelepresenceService();
