import type { Clock } from './Clock';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
