export const up = `
CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
BEFORE UPDATE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
BEFORE DELETE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
`;

export const down = `
DROP TRIGGER IF EXISTS prevent_audit_log_update;
DROP TRIGGER IF EXISTS prevent_audit_log_delete;
`;
