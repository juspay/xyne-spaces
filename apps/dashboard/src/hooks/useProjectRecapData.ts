import { useMemo } from 'react';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';

export interface ProjectRecapPoint {
  point: string;
  channelId: string;
  channelName: string;
  citationIndex: number;
  conversationId?: string;
  messageId?: string;
}

export interface ProjectRecapSummary {
  projectName: string;
  projectId: string;
  summary: string;
  good: ProjectRecapPoint[];
  bad: ProjectRecapPoint[];
  channelCount: number;
  messageCount: number;
}

// Get yesterday's date as a UTC midnight timestamp — matches backend persistRecap logic
const getYesterdayISTTimestamp = (): number => {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = todayStr.split('-');
  const yesterdayDate = new Date(`${year}-${month}-${day}`);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const y = yesterdayDate.getFullYear();
  const m = String(yesterdayDate.getMonth() + 1).padStart(2, '0');
  const d = String(yesterdayDate.getDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T00:00:00Z`).getTime();
};

export const useProjectRecapData = () => {
  const recapDate = useMemo(() => getYesterdayISTTimestamp(), []);

  const [recapRows] = useCachedQuery(queries.projectRecaps({ recapDate }));

  const recaps = useMemo(() => {
    if (!recapRows || recapRows.length === 0) return [];
    return recapRows
      .map(row => {
        try {
          return JSON.parse(row.summary) as ProjectRecapSummary;
        } catch {
          return null;
        }
      })
      .filter((r): r is ProjectRecapSummary => r !== null);
  }, [recapRows]);

  const isLoading = recapRows === null || recapRows === undefined;

  return { recaps, isLoading, error: null as string | null, isAccessDenied: false };
};
