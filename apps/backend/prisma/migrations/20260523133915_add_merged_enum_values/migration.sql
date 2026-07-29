-- Add MERGED_INTO to TicketReferenceRelation enum
ALTER TYPE "public"."TicketReferenceRelation" ADD VALUE 'MERGED_INTO';

-- Add MERGED and UNMERGED to ActivityType enum
ALTER TYPE "public"."ActivityType" ADD VALUE 'MERGED';
ALTER TYPE "public"."ActivityType" ADD VALUE 'UNMERGED';