// The "affinity weights have loaded" signal lives in @xyne/shared (shared with the mobile app). It
// prefetches through the AffinityService this app registers in services/affinityService.
export { useAffinityCallback } from '@xyne/shared/hooks';
