import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { AppDeskTransformer } from './transformer';
import { AppDeskRefetch } from './refetch';

export const appDeskAdapter = AdapterFactory.create(
  ExternalSourcePlatform.APP_DESK,
  undefined,
  new AppDeskTransformer(),
  undefined,
  undefined,
  new AppDeskRefetch(),
);

export { AppDeskTransformer } from './transformer';
export { AppDeskRefetch } from './refetch';
export * from './types';
export * from './errors';
