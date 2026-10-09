/**
 * Relocated to apps/backend/src/bypassAcl/deskMetricsRepository.ts.
 *
 * The desk metrics aggregations are raw SQL (window functions, date_trunc series, percentile
 * aggregates) that Prisma's query builder cannot express, so they bypass the tenant ACL
 * extension and must live in bypassAcl/ (see scripts/validate-no-acl-bypass.sh). The module
 * moved there whole; this file stays as a re-export so no import path changed.
 */
export * from '@/bypassAcl/deskMetricsRepository';
