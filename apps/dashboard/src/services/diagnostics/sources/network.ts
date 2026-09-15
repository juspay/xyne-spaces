import { diagnosticsStore } from '../store';

interface NetworkInformationLike extends EventTarget {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
}

function getConnection(): NetworkInformationLike | undefined {
  return (navigator as unknown as { connection?: NetworkInformationLike }).connection;
}

/**
 * Collapse id-like path segments so one endpoint is one row. Without this a
 * chat app produces a row per conversation id and the table is unreadable.
 */
export function endpointTemplate(url: string): string {
  let path: string;
  try {
    path = new URL(url, window.location.href).pathname;
  } catch {
    path = url;
  }
  return (
    '/' +
    path
      .split('/')
      .filter(Boolean)
      .map(segment => {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(segment)) return ':id';
        if (/^\d+$/.test(segment)) return ':id';
        if (segment.length >= 16) return ':id';
        return segment;
      })
      .join('/')
  );
}

export function startNetworkSource(): () => void {
  const stops: (() => void)[] = [];

  const connection = getConnection();
  if (connection) {
    const publish = (): void => {
      if (typeof connection.rtt === 'number' && connection.rtt > 0) {
        diagnosticsStore.record('networkRtt', connection.rtt);
      }
    };
    publish();
    connection.addEventListener('change', publish);
    stops.push(() => connection.removeEventListener('change', publish));
  } else {
    diagnosticsStore.markUnsupported(
      'networkRtt',
      'This browser does not estimate network latency. API latency below still applies.',
    );
  }

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (entry.initiatorType !== 'fetch' && entry.initiatorType !== 'xmlhttprequest') continue;
          // Only first-party API traffic; third-party assets are not actionable here.
          if (!entry.name.includes('/api/') && !entry.name.includes('/zero')) continue;
          diagnosticsStore.recordApiCall(
            endpointTemplate(entry.name),
            entry.duration,
            entry.transferSize || 0,
          );
        }
      });
      observer.observe({ type: 'resource', buffered: true });
      stops.push(() => observer.disconnect());
    } catch {
      diagnosticsStore.markUnsupported(
        'apiLatencyP95',
        'Request timing is unavailable in this browser.',
      );
    }
  }

  return () => {
    for (const stop of stops) stop();
  };
}

export function readConnectionInfo(): {
  effectiveType: string;
  rttMs: number;
  downlinkMbps: number;
  saveData: boolean;
} | null {
  const connection = getConnection();
  if (!connection) return null;
  return {
    effectiveType: connection.effectiveType ?? 'unknown',
    rttMs: connection.rtt ?? 0,
    downlinkMbps: connection.downlink ?? 0,
    saveData: connection.saveData ?? false,
  };
}
