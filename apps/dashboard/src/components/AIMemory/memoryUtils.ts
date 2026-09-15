import type { MemoryBankMemory } from '@/services/claw/digitalTwinTypes';
import {
  normalizeSubsystem,
  subsystemColor,
  subsystemLabel,
} from '@/components/ClawAgents/digitalTwin/subsystems';
import { fmtDate } from '@/components/ClawAgents/digitalTwin/format';

export const memorySubsystemKey = (memory: MemoryBankMemory): string => {
  const subsystemTag = memory.tags?.find(tag => tag.startsWith('subsystem:'))?.slice(10);
  return normalizeSubsystem(subsystemTag ?? memory.category ?? 'context');
};

export const memorySpineLabel = (memory: MemoryBankMemory): string => {
  const label = subsystemLabel(memorySubsystemKey(memory));
  return label.length > 14 ? `${label.slice(0, 12)}…` : label;
};

export const memorySpineColor = (memory: MemoryBankMemory, index = 0): string =>
  subsystemColor(memorySubsystemKey(memory), index);

const humanize = (value: string): string =>
  value.replaceAll(/[-_]+/g, ' ').replace(/^\w/, first => first.toUpperCase());

export const memoryTitle = (memory: MemoryBankMemory): string => {
  if (memory.title?.trim()) return memory.title.trim();
  const descriptiveTag = memory.tags?.find(tag => !tag.startsWith('subsystem:'));
  if (descriptiveTag) return humanize(descriptiveTag);

  const firstClause = memory.content.split(/[.!?:;]/, 1)[0]?.trim() ?? '';
  const words = firstClause.split(/\s+/).filter(Boolean);
  if (words.length <= 7) return firstClause || 'Untitled memory';
  return `${words.slice(0, 7).join(' ')}…`;
};

export const memoryMetricLabel = (memory: MemoryBankMemory): string | null => {
  if (typeof memory.curatorConfidence === 'number') {
    return `${Math.round(memory.curatorConfidence * 100)}% confidence`;
  }
  if (memory.recallHits7d > 0) {
    return `${memory.recallHits7d} use${memory.recallHits7d === 1 ? '' : 's'}`;
  }
  return null;
};

export const memoryDateLabel = (memory: MemoryBankMemory): string => {
  if (memory.lastRecalledAt) {
    return `${fmtDate(memory.createdAt)} · last used ${fmtDate(memory.lastRecalledAt)}`;
  }
  return fmtDate(memory.createdAt);
};
