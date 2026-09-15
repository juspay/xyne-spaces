import type { Prisma } from '@prisma/client';
import { TENANT_KEY_EXCLUDED_MODELS } from './tenant-key-exclusions';

type ScalarsOf<M extends Prisma.ModelName> = Prisma.TypeMap['model'][M]['payload']['scalars'];

type IsNonNullableKey<T, K extends PropertyKey> = K extends keyof T
  ? null extends T[K]
    ? false
    : true
  : false;

type HasNonNullTenantKey<M extends Prisma.ModelName> =
  IsNonNullableKey<ScalarsOf<M>, 'workspaceId'> extends true
    ? true
    : IsNonNullableKey<ScalarsOf<M>, 'orgId'> extends true
      ? true
      : false;

type ExcludedModel = (typeof TENANT_KEY_EXCLUDED_MODELS)[number];
type ModelsRequiringTenantKey = Exclude<Prisma.ModelName, ExcludedModel>;

type TenantKeyViolations = {
  [M in ModelsRequiringTenantKey]: HasNonNullTenantKey<M> extends true ? never : M;
}[ModelsRequiringTenantKey];

export const _assertNoTenantKeyViolations: TenantKeyViolations extends never
  ? true
  : { TENANT_KEY_VIOLATIONS: TenantKeyViolations } = true;
