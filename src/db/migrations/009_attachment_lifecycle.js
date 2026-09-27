export const up = `
  ALTER TABLE attachments ADD COLUMN expires_at TEXT;

  CREATE TABLE IF NOT EXISTS attachment_retention_policies (
    space_id TEXT PRIMARY KEY,
    retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attachment_download_tokens (
    token_hash TEXT PRIMARY KEY,
    attachment_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE,
    FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_attachment_download_tokens_attachment ON attachment_download_tokens(attachment_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_attachments_expiry ON attachments(space_id, expires_at) WHERE deleted_at IS NULL;
`;

export const down = `
  DROP INDEX IF EXISTS idx_attachment_download_tokens_attachment;
  DROP INDEX IF EXISTS idx_attachments_expiry;
  DROP TABLE IF EXISTS attachment_download_tokens;
  DROP TABLE IF EXISTS attachment_retention_policies;
  ALTER TABLE attachments DROP COLUMN expires_at;
`;
