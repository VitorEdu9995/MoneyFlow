/**
 * ECO-66 S3-FIX: Auditoria via interceptor + testes
 * Garantir append-only na tabela audit_logs.
 */

export const up = `
  -- Trigger para bloquear DELETE
  CREATE TRIGGER IF NOT EXISTS prevent_audit_logs_delete
  BEFORE DELETE ON audit_logs
  BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only');
  END;

  -- Trigger para bloquear UPDATE
  CREATE TRIGGER IF NOT EXISTS prevent_audit_logs_update
  BEFORE UPDATE ON audit_logs
  BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only');
  END;
`;

export const down = `
  DROP TRIGGER IF EXISTS prevent_audit_logs_delete;
  DROP TRIGGER IF EXISTS prevent_audit_logs_update;
`;
