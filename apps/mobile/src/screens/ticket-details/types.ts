import type { ReactNode } from 'react';
import type { ActivityType } from '@xyne/shared';

export type MetaRow = {
  key: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  /** Optional content rendered below the row (e.g. Due Date acknowledge banner). */
  footer?: ReactNode;
};

export type ActivityItem = {
  id: string;
  updatedBy: string;
  activityType: ActivityType;
  timestamp: number;
  value: unknown;
};

export type ActivityGroup = {
  key: string;
  label: string;
  items: ActivityItem[];
};
