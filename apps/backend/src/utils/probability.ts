/** A number that can be a probability: from 0 to 1. */
export const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1;
