/**
 * Relocated to apps/backend/src/bypassAcl/doclingSchedulerStore.ts.
 *
 * This module is written almost entirely in raw SQL — the claim/lease/admission queries need
 * `FOR UPDATE SKIP LOCKED`, `pg_try_advisory_xact_lock` and CTEs that Prisma's query builder
 * cannot express, which also means they do not go through the tenant ACL extension. Raw SQL now
 * lives only in bypassAcl/ (see scripts/validate-no-acl-bypass.sh), so the module moved there
 * whole rather than being split; this file stays as a re-export so no import path changed.
 */
export * from '@/bypassAcl/doclingSchedulerStore';
