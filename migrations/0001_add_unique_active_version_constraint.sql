-- Add unique partial index to ensure only one active version per document
-- This constraint is critical for production data integrity
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS document_one_active_version_idx 
ON document_versions(document_id) 
WHERE is_active = true;