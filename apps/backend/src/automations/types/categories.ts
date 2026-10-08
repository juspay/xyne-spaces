import { z } from 'zod';

export enum TriggerCategory {
  MANUAL = 'manual',
  TIMER = 'timer',
  EVENT = 'event',
}

export const TriggerCategorySchema = z.nativeEnum(TriggerCategory);

export enum StepCategory {
  MESSAGING = 'messaging',
  TICKET = 'ticket',
  CHANNEL = 'channel',
  EXTERNAL = 'external',
  AI = 'ai',
  USER = 'user',
  CONTROL = 'control',
  VALIDATOR = 'validator',
}

export const StepCategorySchema = z.nativeEnum(StepCategory);
