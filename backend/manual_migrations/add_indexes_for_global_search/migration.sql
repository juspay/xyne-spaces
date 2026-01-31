-- Enable pg_trgm extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Add search indexes on message_search table (optimized dedicated search table)
CREATE INDEX IF NOT EXISTS message_search_plaintext_trgm_idx
ON message_search USING GIN ("plaintextContent" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS message_search_vector_idx
ON message_search USING GIN ("searchVector");

-- Restore other search indexes that were dropped
CREATE INDEX IF NOT EXISTS channels_title_trgm_idx
ON "channels" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_name_trgm_idx
ON "users" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
ON "users" USING GIN ("email" gin_trgm_ops);

-- Restore ticket search indexes
CREATE INDEX IF NOT EXISTS tickets_title_trgm_idx
ON "tickets" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tickets_description_trgm_idx
ON "tickets" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tickets_humanReadableId_trgm_idx
ON "tickets" USING GIN ("xyneId" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tickets_fts_idx
ON "tickets" USING GIN (
  to_tsvector(
    'english',
    coalesce("title", '') || ' ' || coalesce("description", '')
  )
);

CREATE INDEX IF NOT EXISTS tickets_conversationId_idx
ON "tickets" ("conversationId");

-- Restore message attachment search indexes
CREATE INDEX IF NOT EXISTS message_attachments_fileName_trgm_idx
ON "message_attachments" USING GIN ("originalFilename" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS message_attachments_mimeType_trgm_idx
ON "message_attachments" USING GIN ("mimetype" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS message_attachments_fts_idx
ON "message_attachments" USING GIN (
  to_tsvector('english', "originalFilename")
);
