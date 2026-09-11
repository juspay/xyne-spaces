import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  LeadershipConfidence,
  LeadershipScope,
} from '@/services/TeamIntelligence/teamIntelligenceService';

export type DashboardScope = 'org' | 'team' | 'member';
export type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'accent';

export interface SectionRequest {
  scope: LeadershipScope;
  from: string;
  to: string;
  teamId?: string;
  userEmail?: string;
}

export interface SnapshotShellProps {
  scope: DashboardScope;
  title: string;
  eyebrow: string;
  reportDate?: string;
  confidence?: LeadershipConfidence;
  momentum?: string;
  narrative: string;
  sectionRequest: SectionRequest;
  children: ReactNode;
}

export interface SectionProps {
  id?: string;
  icon: LucideIcon;
  title: string;
  eyebrow?: string;
  tone?: Tone;
  question?: string;
  children: ReactNode;
}

export interface Signal {
  label: string;
  value: string;
  description: string;
  tone: Tone;
  icon: LucideIcon;
  targetId?: string;
}

export interface TextHeadline {
  title: string;
  text: string;
}

export const SECTION_PAGE_SIZE = 12;

export interface PaginationState<T> {
  pageIndex: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  visibleItems: T[];
}
