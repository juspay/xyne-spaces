import type { OpenIntent } from '../intent/openIntent.types';
import type { ResolvedLocation } from '../intent/resolvedLocation';
import type { OpenFailure } from '../types/openFailure';
import type { DataFacts, LandingTarget, ListMetrics } from './openState';

type Keyed = { readonly intentKey: string };

export type OpenAction =
  | ({ type: 'open'; intent: OpenIntent; now: number } & Keyed)
  | ({ type: 'reanchor'; target: LandingTarget; now: number } & Keyed)
  | ({ type: 'surfaceResolved'; location: ResolvedLocation; now: number } & Keyed)
  | ({ type: 'warmWindowRead'; containsTarget: boolean; hasRows: boolean; now: number } & Keyed)
  | ({ type: 'dataFactsChanged'; facts: DataFacts; now: number } & Keyed)
  | ({ type: 'landingConfirmed'; metrics: ListMetrics } & Keyed)
  | ({ type: 'userTookOwnership' } & Keyed)
  | ({ type: 'tick'; now: number } & Keyed)
  | ({ type: 'retry'; now: number } & Keyed)
  | ({ type: 'fail'; failure: OpenFailure } & Keyed)
  | ({ type: 'teardown' } & Keyed);

export const OPEN_ACTION_TYPES = [
  'open',
  'reanchor',
  'surfaceResolved',
  'warmWindowRead',
  'dataFactsChanged',
  'landingConfirmed',
  'userTookOwnership',
  'tick',
  'retry',
  'fail',
  'teardown',
] as const;

export type OpenActionType = (typeof OPEN_ACTION_TYPES)[number];
