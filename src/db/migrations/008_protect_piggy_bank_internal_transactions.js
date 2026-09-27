/** Protege as duas pernas de transferências internas de cofrinho contra mutação pública. */

/**
 * O marcador é aditivo e não altera lançamentos existentes. Registros legados
 * continuam protegidos pela validação do vínculo em `transfers` no serviço.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function up(db) {
  const columns = db.prepare('PRAGMA table_info(transactions)').all();
  const hasInternalPiggyBankMarker = columns.some((column) => column.name === 'is_piggy_bank_internal');
  if (!hasInternalPiggyBankMarker) {
    db.exec('ALTER TABLE transactions ADD COLUMN is_piggy_bank_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_piggy_bank_internal IN (0, 1));');
  }
}

export const down = `
  -- SQLite não oferece DROP COLUMN portável; o marcador é preservado para auditoria.
`;
