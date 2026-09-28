import { ServiceAccountResourceType } from '../constants';
import { channelResource } from './channel';
import type { ResourceType } from './types';

const RESOURCE_TYPES: Record<ServiceAccountResourceType, ResourceType> = {
  [ServiceAccountResourceType.CHANNEL]: channelResource as ResourceType,
};

export function resourceType(type: ServiceAccountResourceType): ResourceType {
  return RESOURCE_TYPES[type];
}

export type { ResourceType } from './types';
