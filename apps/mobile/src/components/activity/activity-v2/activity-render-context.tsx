import { createContext, useContext } from 'react';
import type { ActivityRowVM } from '@/src/features/activity/presentation/activityRowAssembler';

type ActivityRenderContextValue = {
  compactPreviews: boolean;
  rowVm: ActivityRowVM;
};

const ActivityRenderContext = createContext<ActivityRenderContextValue | null>(null);

export const ActivityRenderProvider = ActivityRenderContext.Provider;

export const useActivityRenderContext = (): ActivityRenderContextValue => {
  const value = useContext(ActivityRenderContext);
  if (!value) {
    throw new Error('useActivityRenderContext must be used within ActivityRenderProvider');
  }
  return value;
};
