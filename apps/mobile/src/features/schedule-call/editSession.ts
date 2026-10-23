import type { EditCallData } from './utils/types';

let active: EditCallData | null = null;

export const openEditSession = (call: EditCallData): void => {
  active = call;
};

export const getEditSession = (): EditCallData | null => active;

export const closeEditSession = (): void => {
  active = null;
};
