import { describe, expect, it } from 'vitest';
import {
  orbStateForProgress,
  progressLabelForField,
  PROGRESS_DRAFTING_NAME,
  PROGRESS_THINKING,
} from './createProgressLabel';
import type { AgentCreateField } from './types';

describe('orbStateForProgress', () => {
  it('composes while writing text fields', () => {
    for (const field of ['name', 'slug', 'description', 'systemPrompt'] as const) {
      expect(orbStateForProgress(progressLabelForField(field))).toBe('composing');
    }
    expect(orbStateForProgress(PROGRESS_DRAFTING_NAME)).toBe('composing');
  });

  it('connects while picking tools and skills, searches for knowledge', () => {
    expect(orbStateForProgress(progressLabelForField('tools'))).toBe('connecting');
    expect(orbStateForProgress(progressLabelForField('skills'))).toBe('connecting');
    expect(orbStateForProgress(progressLabelForField('knowledge'))).toBe('searching');
  });

  it('weaves while settling the rest of the canvas', () => {
    expect(orbStateForProgress(progressLabelForField('schedule'))).toBe('weaving');
    expect(orbStateForProgress(progressLabelForField('properties'))).toBe('weaving');
    expect(orbStateForProgress(PROGRESS_THINKING)).toBe('weaving');
  });

  it('falls back to working for the model thinking and unknown labels', () => {
    expect(orbStateForProgress('Thinking…')).toBe('working');
    expect(orbStateForProgress('Something new…')).toBe('working');
  });

  it('never shows the shaping orb', () => {
    const fields: AgentCreateField[] = [
      'name',
      'slug',
      'description',
      'systemPrompt',
      'tools',
      'skills',
      'knowledge',
      'permissionMode',
      'schedule',
      'properties',
    ];
    const labels = [
      ...fields.map(field => progressLabelForField(field)),
      PROGRESS_DRAFTING_NAME,
      PROGRESS_THINKING,
    ];
    for (const label of labels) expect(orbStateForProgress(label)).not.toBe('shaping');
  });
});
