/**
 * Repositório e serviço de isolamento multi-espaço, membros, sessões e auditoria (ECO-61).
 *
 * Garante que:
 * - Toda query e mutação é restrita ao `spaceId` fornecido.
 * - Usuário só acessa espaços dos quais é membro ativo.
 * - O último owner não pode sair do espaço nem rebaixar seu papel.
 * - Membro revogado é imediatamente impedido em tempo de request.
 * - Referência entre espaços (ex: vincular conta de espaço A em cartão de espaço B) é bloqueada.
 * - Ações críticas geram registros append-only na tabela audit_logs.
 */

import { randomUUID, createHash } from 'node:crypto';
import { AppError, ErrorCodes } from '../domain/envelope.js';
import { Roles, requireAuthorization, Permissions } from '../domain/authorization.js';
import { logger } from '../utils/logger.js';

// Token não serializável: somente este módulo pode marcar uma transferência
// como interna de cofrinho; argumentos recebidos pelo MCP nunca o produzem.
const PIGGY_BANK_INTERNAL_TRANSFER = Symbol('piggy-bank-internal-transfer');

// =========================================================================
// UTILITÁRIOS DE DATA (FASE 2 - ECO-62)
// Todas as datas trafegam como string 'YYYY-MM-DD'. Meses são sempre
// "clampados" ao último dia real do mês de destino (ex: 31/01 + 1 mês = 28
// ou 29/02), evitando estouro de data em Fevereiro para parcelas, faturas
// e recorrências mensais.
// =========================================================================

function lastDayOfMonth(year, month) {
  // `month` é 1-indexado; Date.UTC(year, month, 0) devolve o último dia do mês anterior ao índice 0-based `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampToMonth(year, month, day) {
  const clampedDay = Math.min(day, lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function addMonthsClamped(dateStr, monthsToAdd) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalIndex = (m - 1) + monthsToAdd;
  const year = y + Math.floor(totalIndex / 12);
  const month = (((totalIndex % 12) + 12) % 12) + 1;
  return clampToMonth(year, month, d);
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Calcula o ciclo de fatura (início, fim, fechamento e vencimento) que contém
 * `referenceDate`, a partir dos dias de fechamento/vencimento do cartão.
 * Lida corretamente com meses de 28/29/30/31 dias (ex: fechamento dia 31 em
 * meses menores cai no último dia do mês).
 */
export function computeInvoiceCycle(referenceDate, closingDay, dueDay) {
  const [y, m, d] = referenceDate.split('-').map(Number);
  let closingYear = y;
  let closingMonth = m;
  if (d > Math.min(closingDay, lastDayOfMonth(y, m))) {
    closingMonth += 1;
    if (closingMonth > 12) {
      closingMonth = 1;
      closingYear += 1;
    }
  }
  const closingDate = clampToMonth(closingYear, closingMonth, closingDay);

  let prevMonth = closingMonth - 1;
  let prevYear = closingYear;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevClosingDate = clampToMonth(prevYear, prevMonth, closingDay);
  const cycleStart = addDays(prevClosingDate, 1);
  const cycleEnd = closingDate;

  let dueMonth = closingMonth;
  let dueYear = closingYear;
  if (dueDay <= closingDay) {
    dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
  }
  const dueDate = clampToMonth(dueYear, dueMonth, dueDay);

  return { cycleStart, cycleEnd, closingDate, dueDate };
}

export class SpaceIsolationService {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   */
  constructor(db, { metrics = null } = {}) {
    this.db = db;
    this.metrics = metrics;
  }

  setMetrics(metrics) {
    this.metrics = metrics;
  }

  // =========================================================================
  // ATOMICIDADE ANINHADA E RECÁLCULO DE SALDO (FASE 2 - ECO-62, correção)
  //
  // `_runAtomic` usa SAVEPOINT em vez de BEGIN/COMMIT porque SQLite não permite
  // transações aninhadas: vários métodos (createTransfer, createCardTransaction,
  // registerInvoicePayment, importLocalStorageExport...) já abrem sua própria
  // BEGIN TRANSACTION e chamam createTransaction/updateTransaction/
  // deleteTransaction internamente. SAVEPOINT funciona tanto isolado (abre uma
  // transação implícita) quanto aninhado dentro de uma transação já aberta,
  // então o mesmo helper serve os dois casos sem duplicar lógica.
  // =========================================================================

  _runAtomic(fn) {
    const savepoint = `sp_${randomUUID().replace(/-/g, '')}`;
    this.db.exec(`SAVEPOINT ${savepoint};`);
    try {
      const result = fn();
      this.db.exec(`RELEASE SAVEPOINT ${savepoint};`);
      return result;
    } catch (err) {
      this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
      this.db.exec(`RELEASE SAVEPOINT ${savepoint};`);
      throw err;
    }
  }

  /**
   * Recalcula `accounts.current_balance` a partir de `opening_balance` mais a
   * soma de TODOS os movimentos de CAIXA não excluídos daquela conta — nunca de
   * competência. Por isso `card_purchase` nunca entra aqui (fica só na fatura,
   * como competência, até ser pago) e `card_payment` sempre entra (é o caixa
   * saindo de fato). Transferência soma pela perna (a própria linha já carrega
   * o sinal certo via `destination_account_id`: presente = perna de origem,
   * ausente = perna de destino), nunca as duas pernas na mesma conta.
   *
   * Sempre filtra por `space_id` junto do `accountId`: uma conta de outro
   * espaço (ou inexistente) nunca é tocada. Idempotente e sem efeito colateral
   * quando `accountId` é nulo (ex: compra de cartão, que não movimenta conta).
   */
  _recalculateAccountBalance(spaceId, accountId) {
    if (!accountId) return;

    const account = this.db
      .prepare('SELECT opening_balance FROM accounts WHERE id = ? AND space_id = ?')
      .get(accountId, spaceId);
    if (!account) return; // Nunca recalcula conta de outro espaço ou inexistente.

    const { movement } = this.db
      .prepare(
        `SELECT COALESCE(SUM(
          CASE
            WHEN type = 'income' THEN amount
            WHEN type = 'expense' THEN -amount
            WHEN type = 'card_payment' THEN -amount
            WHEN type = 'refund' THEN amount
            WHEN type = 'transfer' AND destination_account_id IS NOT NULL THEN -amount
            WHEN type = 'transfer' AND destination_account_id IS NULL THEN amount
            ELSE 0
          END
        ), 0) as movement
        FROM transactions
        WHERE space_id = ? AND account_id = ? AND deleted_at IS NULL`,
      )
      .get(spaceId, accountId);

    const newBalance = account.opening_balance + movement;
    this.db
      .prepare("UPDATE accounts SET current_balance = ?, updated_at = datetime('now') WHERE id = ? AND space_id = ?")
      .run(newBalance, accountId, spaceId);

    return newBalance;
  }

  // =========================================================================
  // USUÁRIOS E SESSÕES
  // =========================================================================

  createUser({ id = randomUUID(), email, name }) {
    this.db
      .prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .run(id, email, name);
    return this.getUser(id);
  }

  getUser(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }

  createSession({ id = randomUUID(), userId, tokenHash, expiresInHours = 24 }) {
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
    this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(id, userId, tokenHash, expiresAt);
    return { id, userId, tokenHash, expiresAt };
  }

  getSession(tokenHash) {
    const row = this.db
      .prepare(
        `SELECT s.*, u.email as user_email, u.name as user_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')`,
      )
      .get(tokenHash);
    return row || null;
  }

  revokeSession(tokenHash) {
    this.db
      .prepare(
        "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?",
      )
      .run(tokenHash);
  }

  // =========================================================================
  // ESPAÇOS E MEMBROS
  // =========================================================================

  /**
   * Cria um novo espaço de trabalho e associa o criador como 'owner'.
   */
  createSpace({ id = randomUUID(), name, ownerUserId, currency = 'BRL', timezone = 'America/Sao_Paulo' }) {
    const spaceInsert = this.db.prepare(
      'INSERT INTO spaces (id, name, owner_user_id, currency, timezone) VALUES (?, ?, ?, ?, ?)',
    );
    const memberInsert = this.db.prepare(
      'INSERT INTO space_members (id, space_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
    );

    return this._runAtomic(() => {
      spaceInsert.run(id, name, ownerUserId, currency, timezone);
      memberInsert.run(randomUUID(), id, ownerUserId, Roles.OWNER, 'active');
      this.logAudit({
        spaceId: id,
        actorUserId: ownerUserId,
        action: 'space.create',
        entityType: 'spaces',
        entityId: id,
        newData: { id, name, ownerUserId, currency, timezone },
      });
      return this.getSpace(id);
    });
  }

  getSpace(id) {
    return this.db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) || null;
  }

  /**
   * Obtém a associação de membro de um usuário em um espaço.
   */
  getMembership(spaceId, userId) {
    return (
      this.db
        .prepare(
          'SELECT * FROM space_members WHERE space_id = ? AND user_id = ?',
        )
        .get(spaceId, userId) || null
    );
  }

  /**
   * Constrói o contexto autenticado seguro para o request atual.
   * Valida imediatamente se o usuário é membro ativo do espaço informado.
   */
  resolveAuthContext({ userId, spaceId, requestId = randomUUID() }) {
    if (!userId) {
      throw new AppError(
        ErrorCodes.UNAUTHENTICATED,
        'Usuário não autenticado.',
        401,
      );
    }

    if (!spaceId) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        'Espaço não especificado.',
        403,
      );
    }

    const membership = this.getMembership(spaceId, userId);
    if (!membership || membership.status !== 'active') {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        'Usuário não possui acesso ativo a este espaço de trabalho.',
        403,
      );
    }

    return {
      userId,
      spaceId,
      requestId,
      membership,
    };
  }

  /**
   * Adiciona ou atualiza membro no espaço (apenas owner ou admin).
   */
  addMember(authContext, { targetUserId, role }) {
    requireAuthorization(authContext, Permissions.MEMBERS_MANAGE);

    if (!Object.values(Roles).includes(role)) {
      throw new AppError(ErrorCodes.INVALID_ROLE, `Papel '${role}' inválido.`);
    }

    // Se quem está adicionando for admin, não pode nomear owner
    if (authContext.membership.role === Roles.ADMIN && role === Roles.OWNER) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        'Apenas owners podem conceder o papel de owner.',
        403,
      );
    }

    const existing = this.getMembership(authContext.spaceId, targetUserId);
    const memberId = existing ? existing.id : randomUUID();

    if (existing) {
      this.db
        .prepare(
          "UPDATE space_members SET role = ?, status = 'active', updated_at = datetime('now') WHERE id = ?",
        )
        .run(role, existing.id);
    } else {
      this.db
        .prepare(
          'INSERT INTO space_members (id, space_id, user_id, role, status, invited_by) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(memberId, authContext.spaceId, targetUserId, role, 'active', authContext.userId);
    }

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: existing ? 'member.update_role' : 'member.add',
      entityType: 'space_members',
      entityId: memberId,
      oldData: existing,
      newData: { targetUserId, role, status: 'active' },
    });

    return this.getMembership(authContext.spaceId, targetUserId);
  }

  /**
   * Remove ou revoga um membro do espaço.
   * Regra adversarial crítica: o último owner não pode sair nem ser removido.
   */
  removeMember(authContext, { targetUserId }) {
    requireAuthorization(authContext, Permissions.MEMBERS_MANAGE);

    const targetMembership = this.getMembership(authContext.spaceId, targetUserId);
    if (!targetMembership) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Membro não encontrado neste espaço.', 404);
    }

    if (targetMembership.role === Roles.OWNER) {
      // Conta quantos owners ativos existem
      const ownerCount = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM space_members WHERE space_id = ? AND role = 'owner' AND status = 'active'",
        )
        .get(authContext.spaceId).count;

      if (ownerCount <= 1) {
        throw new AppError(
          ErrorCodes.LAST_OWNER_CANNOT_LEAVE,
          'O último owner não pode sair nem ser removido do espaço.',
          400,
        );
      }
    }

    // Admins não podem remover owners
    if (authContext.membership.role === Roles.ADMIN && targetMembership.role === Roles.OWNER) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        'Admins não possuem permissão para remover owners.',
        403,
      );
    }

    this.db
      .prepare(
        "UPDATE space_members SET status = 'revoked', updated_at = datetime('now') WHERE id = ?",
      )
      .run(targetMembership.id);

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'member.revoke',
      entityType: 'space_members',
      entityId: targetMembership.id,
      oldData: targetMembership,
      newData: { status: 'revoked' },
    });

    return { ok: true, status: 'revoked' };
  }

  // =========================================================================
  // AUDITORIA APPEND-ONLY
  // =========================================================================

  logAudit({
    id = randomUUID(),
    spaceId,
    actorUserId = null,
    action,
    entityType,
    entityId = null,
    oldData = null,
    newData = null,
    ipAddress = null,
    userAgent = null,
  }) {
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, space_id, actor_user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        spaceId,
        actorUserId,
        action,
        entityType,
        entityId,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        ipAddress,
        userAgent,
      );

    this.metrics?.recordAuditEvent();
      
    logger.info(`Audit Log: ${action} on ${entityType}`, {
      auditId: id,
      spaceId,
      actorUserId,
      action,
      entityType,
      entityId,
      oldData,
      newData,
      ipAddress,
      userAgent
    });
      
    return id;
  }

  getAuditLogs(authContext, limit = 50) {
    requireAuthorization(authContext, Permissions.AUDIT_READ);
    return this.db
      .prepare(
        'SELECT * FROM audit_logs WHERE space_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(authContext.spaceId, limit);
  }

  // =========================================================================
  // ENTIDADES FINANCEIRAS COM ISOLAMENTO E PREVENÇÃO DE CROSS-SPACE REFERENCE
  // =========================================================================

  /**
   * Cria conta bancária no espaço do contexto.
   */
  createAccount(
    authContext,
    {
      id = randomUUID(),
      name,
      openingBalance = 0,
      accountType = 'checking',
      currency = 'BRL',
      institutionId = null,
      customLogoAssetId = null,
      useInstitutionLogo = 1,
    },
  ) {
    requireAuthorization(authContext, Permissions.ACCOUNTS_WRITE);

    const instId = institutionId ?? null;
    const logoAssetId = customLogoAssetId ?? null;
    const useLogo = useInstitutionLogo !== undefined ? (useInstitutionLogo ? 1 : 0) : 1;

    this.db
      .prepare(
        `INSERT INTO accounts (
           id, space_id, name, opening_balance, current_balance, account_type, currency,
           institution_id, custom_logo_asset_id, use_institution_logo
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, authContext.spaceId, name, openingBalance, openingBalance, accountType, currency, instId, logoAssetId, useLogo);

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'account.create',
      entityType: 'accounts',
      entityId: id,
      newData: { id, name, openingBalance, accountType, currency, institutionId: instId },
    });

    return this.getAccount(authContext, id);
  }

  getAccount(authContext, accountId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    // Anti-IDOR: busca com space_id obrigatório
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE id = ? AND space_id = ?')
      .get(accountId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Conta não encontrada.', 404);
    }
    return row;
  }

  listAccounts(authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.db
      .prepare(
        'SELECT * FROM accounts WHERE space_id = ? AND archived_at IS NULL ORDER BY name ASC',
      )
      .all(authContext.spaceId);
  }

  /**
   * Cria cartão de crédito garantindo que a conta de pagamento (se informada)
   * pertença obrigatoriamente ao mesmo espaço (Prevenção de Cross-Space Reference).
   */
  createCreditCard(
    authContext,
    {
      id = randomUUID(),
      name,
      closingDay,
      dueDay,
      creditLimit = null,
      paymentAccountId = null,
      brand = null,
      institutionId = null,
      cardBrandId = null,
      customLogoAssetId = null,
      useInstitutionLogo = 1,
      primaryColor = null,
    },
  ) {
    requireAuthorization(authContext, Permissions.CARDS_WRITE);

    // Validação estrita contra Cross-Space Reference
    if (paymentAccountId) {
      const account = this.db
        .prepare('SELECT space_id FROM accounts WHERE id = ?')
        .get(paymentAccountId);
      if (!account || account.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Conta de pagamento pertence a outro espaço ou não existe.',
          403,
        );
      }
    }

    const instId = institutionId ?? null;
    const cBrandId = cardBrandId ?? null;
    const logoAssetId = customLogoAssetId ?? null;
    const useLogo = useInstitutionLogo !== undefined ? (useInstitutionLogo ? 1 : 0) : 1;
    const color = primaryColor ?? null;

    this.db
      .prepare(
        `INSERT INTO credit_cards (
           id, space_id, name, closing_day, due_day, credit_limit, payment_account_id, brand,
           institution_id, card_brand_id, custom_logo_asset_id, use_institution_logo, primary_color
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        authContext.spaceId,
        name,
        closingDay,
        dueDay,
        creditLimit,
        paymentAccountId,
        brand,
        instId,
        cBrandId,
        logoAssetId,
        useLogo,
        color,
      );

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'credit_card.create',
      entityType: 'credit_cards',
      entityId: id,
      newData: { id, name, closingDay, dueDay, creditLimit, paymentAccountId, institutionId: instId, cardBrandId: cBrandId },
    });

    return this.getCreditCard(authContext, id);
  }

  getCreditCard(authContext, cardId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM credit_cards WHERE id = ? AND space_id = ?')
      .get(cardId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Cartão de crédito não encontrado.', 404);
    }
    return row;
  }

  /**
   * Cria categoria no espaço.
   */
  createCategory(authContext, { id = randomUUID(), name, kind, parentId = null, color = null }) {
    requireAuthorization(authContext, Permissions.CATEGORIES_WRITE);

    if (parentId) {
      const parent = this.db
        .prepare('SELECT space_id FROM categories WHERE id = ?')
        .get(parentId);
      if (!parent || parent.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Categoria pai informada pertence a outro espaço ou não existe.',
          403,
        );
      }
    }

    this.db
      .prepare(
        'INSERT INTO categories (id, space_id, name, kind, parent_id, color) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, authContext.spaceId, name, kind, parentId, color);

    return this.getCategory(authContext, id);
  }

  getCategory(authContext, categoryId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM categories WHERE id = ? AND space_id = ?')
      .get(categoryId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Categoria não encontrada.', 404);
    }
    return row;
  }

  /**
   * Cria transação financeira com checagem de espaço em todas as referências
   * (account_id, credit_card_id, category_id, destination_account_id).
   */
  createTransaction(
    authContext,
    {
      id = randomUUID(),
      type,
      description,
      amount,
      accountId = null,
      creditCardId = null,
      categoryId = null,
      destinationAccountId = null,
      transactionDate,
      observation = null,
      tags = [],
      _allowPiggy = false,
      internalTransferToken = null,
    },
  ) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const isPiggyBankInternal = internalTransferToken === PIGGY_BANK_INTERNAL_TRANSFER;
    if (_allowPiggy !== isPiggyBankInternal) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Movimentação interna de cofrinho inválida.', 403);
    }

    // Validação de Cross-Space em todas as FKs
    if (accountId) {
      const acc = this.db.prepare('SELECT space_id, is_piggy_bank FROM accounts WHERE id = ?').get(accountId);
      if (!acc || acc.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Conta pertence a outro espaço ou não existe.',
          403,
        );
      }
      if (acc.is_piggy_bank && !_allowPiggy) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Conta-cofrinho só pode ser movimentada pelas operações de aporte e saque.',
          403,
        );
      }
    }

    if (creditCardId) {
      const card = this.db.prepare('SELECT space_id FROM credit_cards WHERE id = ?').get(creditCardId);
      if (!card || card.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Cartão de crédito pertence a outro espaço ou não existe.',
          403,
        );
      }
    }

    if (categoryId) {
      const cat = this.db.prepare('SELECT space_id FROM categories WHERE id = ?').get(categoryId);
      if (!cat || cat.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Categoria pertence a outro espaço ou não existe.',
          403,
        );
      }
    }

    if (destinationAccountId) {
      const destAcc = this.db.prepare('SELECT space_id FROM accounts WHERE id = ?').get(destinationAccountId);
      if (!destAcc || destAcc.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Conta de destino pertence a outro espaço ou não existe.',
          403,
        );
      }
    }

    return this._runAtomic(() => {
      this.db
        .prepare(
          `INSERT INTO transactions (
            id, space_id, type, description, amount, account_id, credit_card_id,
            category_id, destination_account_id, transaction_date, observation, tags, is_piggy_bank_internal
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          authContext.spaceId,
          type,
          description,
          amount,
          accountId,
          creditCardId,
          categoryId,
          destinationAccountId,
          transactionDate,
          observation,
          JSON.stringify(tags),
          isPiggyBankInternal ? 1 : 0,
        );

      // Recálculo atômico de saldo: mesma unidade de trabalho do INSERT (via
      // SAVEPOINT), nunca um passo solto que possa ficar dessincronizado.
      this._recalculateAccountBalance(authContext.spaceId, accountId);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'transaction.create',
        entityType: 'transactions',
        entityId: id,
        newData: { id, type, description, amount, transactionDate, isPiggyBankInternal },
      });

      return this.getTransaction(authContext, id);
    });
  }

  getTransaction(authContext, transactionId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM transactions WHERE id = ? AND space_id = ? AND deleted_at IS NULL')
      .get(transactionId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Transação não encontrada.', 404);
    }
    return row;
  }

  /**
   * Impede alterações parciais de transferências que movimentam um cofrinho.
   * A consulta de legado mantém protegidos registros criados antes do marcador.
   */
  _assertTransactionCanBeMutated(transaction) {
    const isLegacyPiggyBankInternal = this.db
      .prepare(
        `SELECT 1
         FROM transfers transfer
         JOIN accounts source_account ON source_account.id = transfer.source_account_id
         JOIN accounts destination_account ON destination_account.id = transfer.destination_account_id
         WHERE transfer.space_id = ?
           AND (transfer.source_transaction_id = ? OR transfer.destination_transaction_id = ?)
           AND (source_account.is_piggy_bank = 1 OR destination_account.is_piggy_bank = 1)`,
      )
      .get(transaction.space_id, transaction.id, transaction.id);

    if (transaction.is_piggy_bank_internal || isLegacyPiggyBankInternal) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Transações internas de cofrinho só podem ser movimentadas por aporte ou saque.', 403);
    }
  }

  /**
   * Atualiza campos permitidos de uma transação existente, revalidando
   * qualquer nova referência entre espaços (ex: trocar categoria).
   */
  updateTransaction(authContext, transactionId, updates = {}) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const existing = this.getTransaction(authContext, transactionId);
    this._assertTransactionCanBeMutated(existing);

    if (updates.categoryId) {
      const cat = this.db.prepare('SELECT space_id FROM categories WHERE id = ?').get(updates.categoryId);
      if (!cat || cat.space_id !== authContext.spaceId) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Categoria pertence a outro espaço ou não existe.', 403);
      }
    }

    const columnMap = {
      description: 'description',
      amount: 'amount',
      categoryId: 'category_id',
      observation: 'observation',
      transactionDate: 'transaction_date',
    };

    const setClauses = [];
    const values = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (updates[key] !== undefined) {
        setClauses.push(`${column} = ?`);
        values.push(updates[key]);
      }
    }

    if (setClauses.length === 0) {
      return existing;
    }

    setClauses.push("updated_at = datetime('now')");
    values.push(transactionId, authContext.spaceId);

    return this._runAtomic(() => {
      this.db
        .prepare(`UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ? AND space_id = ?`)
        .run(...values);

      // `amount` é o único campo editável que afeta o caixa; recalcular sempre
      // é barato e mantém current_balance consistente sem precisar decidir
      // caso a caso quais campos "sujam" o saldo.
      this._recalculateAccountBalance(authContext.spaceId, existing.account_id);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'transaction.update',
        entityType: 'transactions',
        entityId: transactionId,
        oldData: existing,
        newData: updates,
      });

      return this.getTransaction(authContext, transactionId);
    });
  }

  /**
   * Exclusão lógica (soft delete) da transação, preservando histórico e auditoria.
   */
  deleteTransaction(authContext, transactionId) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const existing = this.getTransaction(authContext, transactionId);
    this._assertTransactionCanBeMutated(existing);

    return this._runAtomic(() => {
      this.db
        .prepare("UPDATE transactions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
        .run(transactionId, authContext.spaceId);

      this._recalculateAccountBalance(authContext.spaceId, existing.account_id);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'transaction.delete',
        entityType: 'transactions',
        entityId: transactionId,
        oldData: existing,
      });

      return { deleted: true, id: transactionId };
    });
  }

  /**
   * Marca uma transação como paga/recebida (fluxo de caixa), preenchendo
   * `effective_date`. Distinto de `transaction_date` (competência), evitando
   * que caixa e competência sejam somados como o mesmo evento.
   */
  setTransactionPaid(authContext, { transactionId, paid = true, effectiveDate = null }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const existing = this.getTransaction(authContext, transactionId);
    this._assertTransactionCanBeMutated(existing);

    const paidStatus = paid ? 'paid' : 'unpaid';
    const effective = paid ? effectiveDate || existing.transaction_date : null;

    this.db
      .prepare(
        "UPDATE transactions SET paid_status = ?, effective_date = ?, updated_at = datetime('now') WHERE id = ? AND space_id = ?",
      )
      .run(paidStatus, effective, transactionId, authContext.spaceId);

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'transaction.set_paid',
      entityType: 'transactions',
      entityId: transactionId,
      oldData: { paidStatus: existing.paid_status },
      newData: { paidStatus, effective },
    });

    return this.getTransaction(authContext, transactionId);
  }

  /**
   * Resumo por período separando caixa (transações pagas, por effective_date)
   * de competência (todas as transações, por transaction_date), nunca somando
   * os dois como o mesmo evento e excluindo transferências (não são receita/despesa).
   */
  getPeriodSummary(authContext, { year, month, basis = 'accrual' }) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const dateColumn = basis === 'cash' ? 'effective_date' : 'transaction_date';
    const paidFilter = basis === 'cash' ? "AND paid_status = 'paid'" : '';

    const rows = this.db
      .prepare(
        `SELECT type, SUM(amount) as total FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL AND type != 'transfer' ${paidFilter}
         AND substr(${dateColumn}, 1, 7) = ?
         GROUP BY type`,
      )
      .all(authContext.spaceId, prefix);

    const summary = { basis, period: prefix, income: 0, expense: 0 };
    for (const row of rows) {
      if (row.type === 'income') summary.income += row.total;
      else if (row.type === 'expense' || row.type === 'card_purchase') summary.expense += row.total;
      else if (row.type === 'refund') summary.expense -= row.total;
    }
    return summary;
  }

  // =========================================================================
  // TAGS (FASE 2 - ECO-62)
  // =========================================================================

  createTag(authContext, { id = randomUUID(), name, color = null }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const existing = this.db
      .prepare('SELECT * FROM tags WHERE space_id = ? AND name = ?')
      .get(authContext.spaceId, name);
    if (existing) return existing;

    this.db.prepare('INSERT INTO tags (id, space_id, name, color) VALUES (?, ?, ?, ?)').run(
      id,
      authContext.spaceId,
      name,
      color,
    );
    return this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  }

  listTags(authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.db.prepare('SELECT * FROM tags WHERE space_id = ? ORDER BY name ASC').all(authContext.spaceId);
  }

  /**
   * Cria (se necessário) e vincula tags a uma ou mais transações do mesmo espaço.
   */
  addTransactionsTags(authContext, { transactionIds, tagNames }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'É necessário informar ao menos uma transação.', 400);
    }
    if (!Array.isArray(tagNames) || tagNames.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'É necessário informar ao menos uma tag.', 400);
    }

    this._runAtomic(() => {
      const tagIds = tagNames.map((name) => this.createTag(authContext, { name }).id);
      const insertLink = this.db.prepare(
        'INSERT OR IGNORE INTO transaction_tags (space_id, transaction_id, tag_id) VALUES (?, ?, ?)',
      );

      for (const transactionId of transactionIds) {
        const tx = this.db
          .prepare('SELECT * FROM transactions WHERE id = ? AND space_id = ? AND deleted_at IS NULL')
          .get(transactionId, authContext.spaceId);
        if (!tx) {
          throw new AppError(ErrorCodes.NOT_FOUND, `Transação '${transactionId}' não encontrada.`, 404);
        }
        this._assertTransactionCanBeMutated(tx);
        for (const tagId of tagIds) {
          insertLink.run(authContext.spaceId, transactionId, tagId);
        }
      }
    });

    return transactionIds.map((transactionId) => ({
      transactionId,
      tags: this.listTransactionTags(authContext, transactionId),
    }));
  }

  listTransactionTags(authContext, transactionId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.db
      .prepare(
        `SELECT t.* FROM tags t
         JOIN transaction_tags tt ON tt.tag_id = t.id
         WHERE tt.transaction_id = ? AND tt.space_id = ?
         ORDER BY t.name ASC`,
      )
      .all(transactionId, authContext.spaceId);
  }

  // =========================================================================
  // TRANSFERÊNCIAS PAREADAS ENTRE CONTAS (FASE 2 - ECO-62)
  // Nunca contabilizadas como receita/despesa consolidada (type = 'transfer').
  // =========================================================================

  createTransfer(
    authContext,
    {
      id = randomUUID(), sourceAccountId, destinationAccountId, amount, transferDate,
      description = 'Transferência entre contas', _allowPiggy = false, internalTransferToken = null,
    },
  ) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const isPiggyBankInternal = internalTransferToken === PIGGY_BANK_INTERNAL_TRANSFER;
    if (_allowPiggy !== isPiggyBankInternal) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Movimentação interna de cofrinho inválida.', 403);
    }

    if (!sourceAccountId || !destinationAccountId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Conta de origem e de destino são obrigatórias.', 400);
    }
    if (sourceAccountId === destinationAccountId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Conta de origem e de destino não podem ser a mesma.', 400);
    }
    if (!(amount > 0)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Valor da transferência deve ser positivo.', 400);
    }

    const source = this.db
      .prepare('SELECT * FROM accounts WHERE id = ? AND space_id = ?')
      .get(sourceAccountId, authContext.spaceId);
    if (!source) {
      throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Conta de origem pertence a outro espaço ou não existe.', 403);
    }
    if (!_allowPiggy && source.is_piggy_bank) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Use cofrinho_withdraw para sacar de uma conta-cofrinho.', 400);
    }

    const destination = this.db
      .prepare('SELECT * FROM accounts WHERE id = ? AND space_id = ?')
      .get(destinationAccountId, authContext.spaceId);
    if (!destination) {
      throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Conta de destino pertence a outro espaço ou não existe.', 403);
    }
    if (!_allowPiggy && destination.is_piggy_bank) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Use cofrinho_deposit para depositar em uma conta-cofrinho.', 400);
    }

    if (isPiggyBankInternal) {
      if (Boolean(source.is_piggy_bank) === Boolean(destination.is_piggy_bank)) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Transferência interna deve envolver exatamente uma conta-cofrinho.', 400);
      }
      const piggyBankAccountId = source.is_piggy_bank ? source.id : destination.id;
      const piggyBank = this.db
        .prepare('SELECT id FROM piggy_banks WHERE account_id = ? AND space_id = ?')
        .get(piggyBankAccountId, authContext.spaceId);
      if (!piggyBank) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Conta-cofrinho interna inválida.', 400);
      }
    }

    if (source.currency !== destination.currency) {
      throw new AppError(
        ErrorCodes.CURRENCY_MISMATCH,
        `Transferência entre moedas incompatíveis: origem '${source.currency}' e destino '${destination.currency}'.`,
        400,
      );
    }

    const sourceTransactionId = randomUUID();
    const destinationTransactionId = randomUUID();

    return this._runAtomic(() => {
      this.createTransaction(authContext, {
        id: sourceTransactionId,
        type: 'transfer',
        description,
        amount,
        accountId: sourceAccountId,
        destinationAccountId,
        transactionDate: transferDate,
        _allowPiggy,
        internalTransferToken,
      });

      this.createTransaction(authContext, {
        id: destinationTransactionId,
        type: 'transfer',
        description,
        amount,
        accountId: destinationAccountId,
        transactionDate: transferDate,
        _allowPiggy,
        internalTransferToken,
      });

      this.db
        .prepare(
          `INSERT INTO transfers (
            id, space_id, source_account_id, destination_account_id,
            source_transaction_id, destination_transaction_id, amount, currency, transfer_date, description
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          authContext.spaceId,
          sourceAccountId,
          destinationAccountId,
          sourceTransactionId,
          destinationTransactionId,
          amount,
          source.currency,
          transferDate,
          description,
        );

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'transfer.create',
        entityType: 'transfers',
        entityId: id,
        newData: { sourceAccountId, destinationAccountId, amount, transferDate },
      });

      return this.getTransfer(authContext, id);
    });
  }

  getTransfer(authContext, transferId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM transfers WHERE id = ? AND space_id = ?')
      .get(transferId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Transferência não encontrada.', 404);
    }
    return row;
  }

  // =========================================================================
  // CICLO DE FATURA DE CARTÃO: COMPRAS, ESTORNOS, PAGAMENTOS E REABERTURA
  // (FASE 2 - ECO-62)
  // =========================================================================

  /**
   * Busca a fatura cujo ciclo contém `referenceDate`; cria automaticamente
   * se ainda não existir (fatura sempre aberta ao nascer).
   */
  getOrCreateOpenInvoice(authContext, creditCardId, referenceDate) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const card = this.getCreditCard(authContext, creditCardId);
    const { cycleStart, cycleEnd, closingDate, dueDate } = computeInvoiceCycle(
      referenceDate,
      card.closing_day,
      card.due_day,
    );

    let invoice = this.db
      .prepare('SELECT * FROM credit_card_invoices WHERE space_id = ? AND credit_card_id = ? AND cycle_start = ?')
      .get(authContext.spaceId, creditCardId, cycleStart);

    if (!invoice) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO credit_card_invoices (
            id, space_id, credit_card_id, cycle_start, cycle_end, closing_date, due_date, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        )
        .run(id, authContext.spaceId, creditCardId, cycleStart, cycleEnd, closingDate, dueDate);
      invoice = this.db.prepare('SELECT * FROM credit_card_invoices WHERE id = ?').get(id);
    }

    return invoice;
  }

  getCreditCardInvoice(authContext, invoiceId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM credit_card_invoices WHERE id = ? AND space_id = ?')
      .get(invoiceId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Fatura não encontrada.', 404);
    }
    return row;
  }

  /**
   * Cria uma compra ou estorno no cartão, resolvendo/criando automaticamente
   * a fatura do ciclo correspondente e atualizando seus totais. Uma cobrança
   * tardia em fatura já fechada/paga a reabre automaticamente (status 'reopened').
   */
  createCardTransaction(
    authContext,
    { id = randomUUID(), type, creditCardId, amount, description, categoryId = null, transactionDate, observation = null },
  ) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    if (!['card_purchase', 'refund'].includes(type)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Tipo deve ser 'card_purchase' ou 'refund'.", 400);
    }

    const invoice = this.getOrCreateOpenInvoice(authContext, creditCardId, transactionDate);

    return this._runAtomic(() => {
      this.createTransaction(authContext, {
        id,
        type,
        description,
        amount,
        creditCardId,
        categoryId,
        transactionDate,
        observation,
      });

      this.db
        .prepare('UPDATE transactions SET credit_card_invoice_id = ? WHERE id = ? AND space_id = ?')
        .run(invoice.id, id, authContext.spaceId);

      if (type === 'card_purchase') {
        this.db
          .prepare(
            `UPDATE credit_card_invoices
             SET total_charges = total_charges + ?, open_amount = open_amount + ?, updated_at = datetime('now'),
                 status = CASE WHEN status IN ('closed', 'paid') THEN 'reopened' ELSE status END
             WHERE id = ?`,
          )
          .run(amount, amount, invoice.id);
      } else {
        this.db
          .prepare(
            `UPDATE credit_card_invoices
             SET total_credits = total_credits + ?, open_amount = open_amount - ?, updated_at = datetime('now')
             WHERE id = ?`,
          )
          .run(amount, amount, invoice.id);
      }

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: `card_transaction.${type}`,
        entityType: 'transactions',
        entityId: id,
        newData: { creditCardId, amount, invoiceId: invoice.id },
      });

      return this.getTransaction(authContext, id);
    });
  }

  getInvoicePaymentSummary(authContext, invoiceId) {
    const invoice = this.getCreditCardInvoice(authContext, invoiceId);
    const payments = this.db
      .prepare('SELECT * FROM invoice_payments WHERE credit_card_invoice_id = ? AND space_id = ? ORDER BY payment_date DESC')
      .all(invoiceId, authContext.spaceId);
    return {
      invoice,
      payments,
      excessAmount: Math.max(0, -invoice.open_amount),
    };
  }

  /**
   * Registra pagamento (parcial, integral ou excedente) de uma fatura.
   * Idempotente via `idempotencyKey`: reenviar a mesma chave NÃO cria um
   * segundo pagamento, apenas devolve o resultado já processado.
   */
  registerInvoicePayment(authContext, { id = randomUUID(), invoiceId, amount, paymentDate, accountId = null, idempotencyKey = null }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);

    if (idempotencyKey) {
      const existingPayment = this.db
        .prepare('SELECT * FROM invoice_payments WHERE space_id = ? AND idempotency_key = ? AND reversed_at IS NULL')
        .get(authContext.spaceId, idempotencyKey);
      if (existingPayment) {
        return { ...this.getInvoicePaymentSummary(authContext, existingPayment.credit_card_invoice_id), duplicate: true, paymentId: existingPayment.id };
      }
    }

    const invoice = this.getCreditCardInvoice(authContext, invoiceId);
    if (!(amount > 0)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Valor do pagamento deve ser positivo.', 400);
    }

    if (accountId) {
      const account = this.db.prepare('SELECT space_id FROM accounts WHERE id = ?').get(accountId);
      if (!account || account.space_id !== authContext.spaceId) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Conta de pagamento pertence a outro espaço ou não existe.', 403);
      }
    }

    const transactionId = randomUUID();

    return this._runAtomic(() => {
      this.createTransaction(authContext, {
        id: transactionId,
        type: 'card_payment',
        description: 'Pagamento de fatura',
        amount,
        accountId,
        transactionDate: paymentDate,
      });
      this.setTransactionPaid(authContext, { transactionId, paid: true, effectiveDate: paymentDate });

      this.db
        .prepare(
          `INSERT INTO invoice_payments (id, space_id, credit_card_invoice_id, transaction_id, amount, payment_date, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, authContext.spaceId, invoiceId, transactionId, amount, paymentDate, idempotencyKey);

      const owed = invoice.total_charges - invoice.total_credits;
      const newTotalPaid = invoice.total_paid + amount;
      const newOpenAmount = owed - newTotalPaid; // negativo = crédito/excedente para a próxima fatura
      const newStatus = newTotalPaid >= owed ? 'paid' : 'partially_paid';

      this.db
        .prepare(
          `UPDATE credit_card_invoices SET total_paid = ?, open_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(newTotalPaid, newOpenAmount, newStatus, invoiceId);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'invoice_payment.register',
        entityType: 'invoice_payments',
        entityId: id,
        newData: { invoiceId, amount, paymentDate },
      });

      return { ...this.getInvoicePaymentSummary(authContext, invoiceId), duplicate: false, paymentId: id };
    });
  }

  /**
   * Desfaz um pagamento informado (uninform), reabrindo a fatura conforme
   * necessário. A transação financeira do pagamento é excluída logicamente.
   */
  uninformInvoicePayment(authContext, { paymentId }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const payment = this.db
      .prepare('SELECT * FROM invoice_payments WHERE id = ? AND space_id = ? AND reversed_at IS NULL')
      .get(paymentId, authContext.spaceId);
    if (!payment) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Pagamento não encontrado.', 404);
    }

    const invoice = this.getCreditCardInvoice(authContext, payment.credit_card_invoice_id);

    return this._runAtomic(() => {
      this.db.prepare("UPDATE invoice_payments SET reversed_at = datetime('now') WHERE id = ?").run(paymentId);

      if (payment.transaction_id) {
        const paymentTransaction = this.db
          .prepare('SELECT account_id FROM transactions WHERE id = ? AND space_id = ?')
          .get(payment.transaction_id, authContext.spaceId);

        this.db
          .prepare("UPDATE transactions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
          .run(payment.transaction_id, authContext.spaceId);

        // Desfazer o pagamento devolve o dinheiro à conta pagadora (mesma
        // transação SQL do soft-delete acima, atômico com o resto do uninform).
        this._recalculateAccountBalance(authContext.spaceId, paymentTransaction?.account_id ?? null);
      }

      const owed = invoice.total_charges - invoice.total_credits;
      const newTotalPaid = Math.max(0, invoice.total_paid - payment.amount);
      const newOpenAmount = owed - newTotalPaid;
      let newStatus = invoice.status;
      if (invoice.status === 'paid' || invoice.status === 'partially_paid') {
        newStatus = newTotalPaid > 0 ? 'partially_paid' : 'reopened';
      }

      this.db
        .prepare(
          `UPDATE credit_card_invoices SET total_paid = ?, open_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(newTotalPaid, newOpenAmount, newStatus, invoice.id);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'invoice_payment.uninform',
        entityType: 'invoice_payments',
        entityId: paymentId,
        oldData: { amount: payment.amount },
      });

      return this.getInvoicePaymentSummary(authContext, invoice.id);
    });
  }

  // =========================================================================
  // PARCELAMENTOS (FASE 2 - ECO-62)
  // Soma exata em centavos: o resto da divisão é distribuído 1 centavo por
  // vez nas PRIMEIRAS parcelas, garantindo soma(parcelas) === total_amount.
  // =========================================================================

  createInstallmentPlan(
    authContext,
    { id = randomUUID(), description, totalAmount, installmentsCount, firstDueDate, accountId = null, creditCardId = null, categoryId = null },
  ) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);

    if (!Number.isInteger(installmentsCount) || installmentsCount < 2) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Parcelamento exige ao menos 2 parcelas.', 400);
    }
    if (!(totalAmount > 0)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Valor total do parcelamento deve ser positivo.', 400);
    }
    if (!accountId && !creditCardId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Informe a conta ou o cartão de crédito do parcelamento.', 400);
    }

    const base = Math.floor(totalAmount / installmentsCount);
    const remainder = totalAmount - base * installmentsCount;

    return this._runAtomic(() => {
      this.db
        .prepare(
          `INSERT INTO installment_plans (
            id, space_id, description, total_amount, installments_count, account_id, credit_card_id, category_id, first_due_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, authContext.spaceId, description, totalAmount, installmentsCount, accountId, creditCardId, categoryId, firstDueDate);

      let sumCheck = 0;
      for (let i = 0; i < installmentsCount; i += 1) {
        const installmentAmount = base + (i < remainder ? 1 : 0);
        sumCheck += installmentAmount;
        const dueDate = addMonthsClamped(firstDueDate, i);
        const installmentTransactionId = randomUUID();
        const installmentDescription = `${description} (${i + 1}/${installmentsCount})`;

        if (creditCardId) {
          this.createCardTransaction(authContext, {
            id: installmentTransactionId,
            type: 'card_purchase',
            creditCardId,
            amount: installmentAmount,
            description: installmentDescription,
            categoryId,
            transactionDate: dueDate,
          });
        } else {
          this.createTransaction(authContext, {
            id: installmentTransactionId,
            type: 'expense',
            description: installmentDescription,
            amount: installmentAmount,
            accountId,
            categoryId,
            transactionDate: dueDate,
          });
        }

        this.db
          .prepare(
            'UPDATE transactions SET installment_plan_id = ?, installment_number = ?, total_installments = ? WHERE id = ? AND space_id = ?',
          )
          .run(id, i + 1, installmentsCount, installmentTransactionId, authContext.spaceId);
      }

      if (sumCheck !== totalAmount) {
        // Defesa em profundidade: nunca deve ocorrer dado o cálculo determinístico acima.
        throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Soma das parcelas não bate com o valor total.', 500);
      }

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'installment_plan.create',
        entityType: 'installment_plans',
        entityId: id,
        newData: { totalAmount, installmentsCount },
      });

      return this.getInstallmentPlan(authContext, id);
    });
  }

  getInstallmentPlan(authContext, planId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const plan = this.db.prepare('SELECT * FROM installment_plans WHERE id = ? AND space_id = ?').get(planId, authContext.spaceId);
    if (!plan) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Plano de parcelamento não encontrado.', 404);
    }
    const installments = this.db
      .prepare('SELECT * FROM transactions WHERE installment_plan_id = ? AND space_id = ? AND deleted_at IS NULL ORDER BY installment_number ASC')
      .all(planId, authContext.spaceId);
    return { ...plan, installments };
  }

  // =========================================================================
  // RECORRÊNCIAS E PREVISÕES (FASE 2 - ECO-62)
  // =========================================================================

  createRecurrence(
    authContext,
    {
      id = randomUUID(),
      description,
      type,
      amount,
      accountId = null,
      creditCardId = null,
      categoryId = null,
      frequency = 'monthly',
      dayOfMonth = null,
      startDate,
      endDate = null,
    },
  ) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);

    if (!['income', 'expense'].includes(type)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Tipo da recorrência deve ser 'income' ou 'expense'.", 400);
    }
    if (!(amount > 0)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Valor da recorrência deve ser positivo.', 400);
    }
    if (!['monthly', 'weekly', 'yearly'].includes(frequency)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Frequência inválida.', 400);
    }

    for (const [fieldId, table, label] of [
      [accountId, 'accounts', 'Conta'],
      [creditCardId, 'credit_cards', 'Cartão de crédito'],
      [categoryId, 'categories', 'Categoria'],
    ]) {
      if (fieldId) {
        const row = this.db.prepare(`SELECT space_id FROM ${table} WHERE id = ?`).get(fieldId);
        if (!row || row.space_id !== authContext.spaceId) {
          throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, `${label} pertence a outro espaço ou não existe.`, 403);
        }
      }
    }

    const resolvedDayOfMonth = dayOfMonth || Number(startDate.split('-')[2]);

    this.db
      .prepare(
        `INSERT INTO recurrences (
          id, space_id, description, type, amount, account_id, credit_card_id, category_id,
          frequency, day_of_month, start_date, end_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        authContext.spaceId,
        description,
        type,
        amount,
        accountId,
        creditCardId,
        categoryId,
        frequency,
        resolvedDayOfMonth,
        startDate,
        endDate,
      );

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'recurrence.create',
      entityType: 'recurrences',
      entityId: id,
      newData: { description, type, amount, frequency, startDate },
    });

    return this.getRecurrence(authContext, id);
  }

  getRecurrence(authContext, recurrenceId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM recurrences WHERE id = ? AND space_id = ?')
      .get(recurrenceId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Recorrência não encontrada.', 404);
    }
    return row;
  }

  listRecurrences(authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.db
      .prepare("SELECT * FROM recurrences WHERE space_id = ? AND status != 'finished' ORDER BY start_date ASC")
      .all(authContext.spaceId);
  }

  _computeRecurrenceOccurrenceDate(recurrence, index) {
    if (recurrence.frequency === 'monthly') return addMonthsClamped(recurrence.start_date, index);
    if (recurrence.frequency === 'yearly') return addMonthsClamped(recurrence.start_date, index * 12);
    return addDays(recurrence.start_date, index * 7); // weekly
  }

  /**
   * Gera (idempotentemente) as ocorrências de previsão de uma recorrência até
   * `untilDate`, sem duplicar ocorrências já geradas para a mesma data.
   */
  generateForecastOccurrences(authContext, { recurrenceId, untilDate }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const recurrence = this.getRecurrence(authContext, recurrenceId);

    const existingDates = new Set(
      this.db
        .prepare('SELECT occurrence_date FROM recurrence_occurrences WHERE recurrence_id = ? AND space_id = ?')
        .all(recurrenceId, authContext.spaceId)
        .map((r) => r.occurrence_date),
    );

    const created = [];
    const insertStmt = this.db.prepare(
      `INSERT INTO recurrence_occurrences (id, space_id, recurrence_id, occurrence_date, status) VALUES (?, ?, ?, ?, 'forecast')`,
    );

    const MAX_OCCURRENCES = 600; // limite de segurança (ex: 50 anos em recorrência mensal)
    for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
      const occurrenceDate = this._computeRecurrenceOccurrenceDate(recurrence, i);
      if (occurrenceDate > untilDate) break;
      if (recurrence.end_date && occurrenceDate > recurrence.end_date) break;

      if (!existingDates.has(occurrenceDate)) {
        const occId = randomUUID();
        insertStmt.run(occId, authContext.spaceId, recurrenceId, occurrenceDate);
        created.push({ id: occId, recurrenceId, occurrenceDate, status: 'forecast' });
      }
    }

    return created;
  }

  listRecurrenceOccurrences(authContext, recurrenceId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.db
      .prepare('SELECT * FROM recurrence_occurrences WHERE recurrence_id = ? AND space_id = ? ORDER BY occurrence_date ASC')
      .all(recurrenceId, authContext.spaceId);
  }

  /**
   * Promove uma previsão (ocorrência de recorrência) a um lançamento real.
   * Uma ocorrência já promovida não pode ser promovida novamente.
   */
  promoteForecastToTransaction(authContext, { occurrenceId }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const occurrence = this.db
      .prepare('SELECT * FROM recurrence_occurrences WHERE id = ? AND space_id = ?')
      .get(occurrenceId, authContext.spaceId);
    if (!occurrence) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Previsão não encontrada.', 404);
    }
    if (occurrence.status === 'promoted') {
      throw new AppError(ErrorCodes.OCCURRENCE_ALREADY_PROMOTED, 'Esta previsão já foi promovida a lançamento real.', 409);
    }

    const recurrence = this.getRecurrence(authContext, occurrence.recurrence_id);
    const transactionId = randomUUID();

    return this._runAtomic(() => {
      this.createTransaction(authContext, {
        id: transactionId,
        type: recurrence.type,
        description: recurrence.description,
        amount: recurrence.amount,
        accountId: recurrence.account_id,
        creditCardId: recurrence.credit_card_id,
        categoryId: recurrence.category_id,
        transactionDate: occurrence.occurrence_date,
      });

      this.db
        .prepare('UPDATE transactions SET recurrence_id = ? WHERE id = ? AND space_id = ?')
        .run(recurrence.id, transactionId, authContext.spaceId);

      this.db
        .prepare("UPDATE recurrence_occurrences SET status = 'promoted', transaction_id = ? WHERE id = ?")
        .run(transactionId, occurrenceId);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'recurrence_occurrence.promote',
        entityType: 'recurrence_occurrences',
        entityId: occurrenceId,
        newData: { transactionId },
      });

      return this.getTransaction(authContext, transactionId);
    });
  }

  // =========================================================================
  // EXCLUSÃO COM ARQUIVAMENTO PREFERENCIAL E IMPACTO (FASE 2 - ECO-62)
  // Entidades com histórico associado NUNCA são apagadas fisicamente:
  // são arquivadas e o impacto (registros afetados) é devolvido ao chamador.
  // =========================================================================

  deleteAccount(authContext, accountId) {
    requireAuthorization(authContext, Permissions.ACCOUNTS_WRITE);
    this.getAccount(authContext, accountId);

    const impact = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL AND (account_id = ? OR destination_account_id = ?)`,
      )
      .get(authContext.spaceId, accountId, accountId).count;

    if (impact > 0) {
      this.db
        .prepare("UPDATE accounts SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
        .run(accountId, authContext.spaceId);
      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'account.archive',
        entityType: 'accounts',
        entityId: accountId,
        newData: { impactTransactions: impact },
      });
      return { archived: true, deleted: false, impact: { transactionsCount: impact } };
    }

    this.db.prepare('DELETE FROM accounts WHERE id = ? AND space_id = ?').run(accountId, authContext.spaceId);
    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'account.delete',
      entityType: 'accounts',
      entityId: accountId,
    });
    return { archived: false, deleted: true, impact: { transactionsCount: 0 } };
  }

  deleteCategory(authContext, categoryId) {
    requireAuthorization(authContext, Permissions.CATEGORIES_WRITE);
    this.getCategory(authContext, categoryId);

    const txCount = this.db
      .prepare('SELECT COUNT(*) as count FROM transactions WHERE space_id = ? AND category_id = ? AND deleted_at IS NULL')
      .get(authContext.spaceId, categoryId).count;
    const childCount = this.db
      .prepare('SELECT COUNT(*) as count FROM categories WHERE space_id = ? AND parent_id = ?')
      .get(authContext.spaceId, categoryId).count;
    const itemCount = this.db
      .prepare('SELECT COUNT(*) as count FROM purchase_items WHERE space_id = ? AND category_id = ?')
      .get(authContext.spaceId, categoryId).count;
    const impact = txCount + childCount + itemCount;

    if (impact > 0) {
      this.db
        .prepare("UPDATE categories SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
        .run(categoryId, authContext.spaceId);
      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'category.archive',
        entityType: 'categories',
        entityId: categoryId,
        newData: { txCount, childCount, itemCount },
      });
      return {
        archived: true,
        deleted: false,
        impact: { transactionsCount: txCount, childCategoriesCount: childCount, purchaseItemsCount: itemCount },
      };
    }

    this.db.prepare('DELETE FROM categories WHERE id = ? AND space_id = ?').run(categoryId, authContext.spaceId);
    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'category.delete',
      entityType: 'categories',
      entityId: categoryId,
    });
    return { archived: false, deleted: true, impact: { transactionsCount: 0, childCategoriesCount: 0, purchaseItemsCount: 0 } };
  }

  deleteCreditCard(authContext, cardId) {
    requireAuthorization(authContext, Permissions.CARDS_WRITE);
    this.getCreditCard(authContext, cardId);

    const txCount = this.db
      .prepare('SELECT COUNT(*) as count FROM transactions WHERE space_id = ? AND credit_card_id = ? AND deleted_at IS NULL')
      .get(authContext.spaceId, cardId).count;
    const invoiceCount = this.db
      .prepare('SELECT COUNT(*) as count FROM credit_card_invoices WHERE space_id = ? AND credit_card_id = ?')
      .get(authContext.spaceId, cardId).count;
    const impact = txCount + invoiceCount;

    if (impact > 0) {
      this.db
        .prepare("UPDATE credit_cards SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
        .run(cardId, authContext.spaceId);
      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'credit_card.archive',
        entityType: 'credit_cards',
        entityId: cardId,
        newData: { txCount, invoiceCount },
      });
      return { archived: true, deleted: false, impact: { transactionsCount: txCount, invoicesCount: invoiceCount } };
    }

    this.db.prepare('DELETE FROM credit_cards WHERE id = ? AND space_id = ?').run(cardId, authContext.spaceId);
    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'credit_card.delete',
      entityType: 'credit_cards',
      entityId: cardId,
    });
    return { archived: false, deleted: true, impact: { transactionsCount: 0, invoicesCount: 0 } };
  }

  // =========================================================================
  // IMPORTAÇÃO IDEMPOTENTE DO SLICE LOCAL (MVP EM localStorage) (FASE 2 - ECO-62)
  //
  // Formato REAL persistido em `localStorage.setItem('moneyflow-state-v1', ...)`,
  // confirmado lendo o worktree do MVP (local-20260925-iniciar-o-moneyflow-como-
  // aplicat, `src/main.js` + `src/domain/finance.js`) — substituiu o contrato
  // hipotético desta fase, que nunca existiu de verdade em produção:
  //
  // {
  //   accounts: [{ id, name, institution?, type?, balance, source? }],
  //   cards: [{ id, name, brand?, closingDay, dueDay, creditLimit?, paymentAccountId?, source? }],
  //   transactions: [{ id, type, description, amount, transactionDate,
  //                     accountId?, creditCardId?, invoiceId?, category?, source? }],
  //   payments: [{ id, invoiceId, fromAccountId, amount, paymentDate, source?, externalTransactionId?, status? }]
  // }
  //
  // Diferenças importantes em relação ao que se imaginaria:
  // - NÃO existe `categories`: categoria é texto livre por transação
  //   (`transaction.category`), resolvido/criado aqui por nome (kind inferido:
  //   'income' para type='income', 'expense' para os demais).
  // - NÃO existe `localId`: o `id` de cada entidade JÁ é a identidade local,
  //   reaproveitada diretamente como FK por outras entidades.
  // - `payments[]` é a fonte de verdade do pagamento de fatura. A UI do MVP
  //   também grava, em paralelo, uma transação espelho `type: 'card_payment'`
  //   para o MESMO evento de caixa (ver app.addEventListener('submit', ...) em
  //   src/main.js do MVP) — importar as duas duplicaria o débito. Por isso
  //   `payments[]` é processado via `registerInvoicePayment` (que já gera sua
  //   própria transação `card_payment`), e linhas `type: 'card_payment'` de
  //   `transactions[]` são puladas de propósito (não contam como inválidas).
  // - `payment.invoiceId` segue o formato `${card.id}-${closingDateISO}` (ver
  //   `getInvoiceForPurchase` no MVP); o cartão e a data de fechamento são
  //   resolvidos a partir desse prefixo, sem inventar um `creditCardId` que o
  //   MVP nunca gravou no pagamento.
  //
  // Garantias mantidas: idempotente (checksum do payload bruto), validado
  // (linhas inválidas contadas em `skipped`, nunca inventadas), reversível
  // (import_entities rastreia contas/cartões/categorias/transações criadas —
  // ver migration 004 para o `entity_type = 'credit_cards'`), o export
  // original é preservado integralmente em `raw_payload`, isolamento por
  // `space_id` reaproveitado de cada método chamado (createAccount,
  // createCreditCard, createCategory, createTransaction, createCardTransaction,
  // registerInvoicePayment) e `current_balance` recalculado atomicamente por
  // cada uma dessas chamadas (ver `_recalculateAccountBalance`), sem contar
  // `card_purchase` (competência) como caixa.
  // =========================================================================

  _resolveOrCreateCategoryByName(authContext, name, kind, cache) {
    const cacheKey = `${kind}::${name}`;
    if (cache.has(cacheKey)) return { id: cache.get(cacheKey), created: false };

    const existing = this.db
      .prepare('SELECT id FROM categories WHERE space_id = ? AND name = ? AND kind = ? AND archived_at IS NULL')
      .get(authContext.spaceId, name, kind);
    if (existing) {
      cache.set(cacheKey, existing.id);
      return { id: existing.id, created: false };
    }

    const createdCategory = this.createCategory(authContext, { name, kind });
    cache.set(cacheKey, createdCategory.id);
    return { id: createdCategory.id, created: true };
  }

  importLocalStorageExport(authContext, { payload }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);

    if (!payload || typeof payload !== 'object') {
      throw new AppError(ErrorCodes.IMPORT_INVALID_PAYLOAD, 'Payload de importação ausente ou inválido.', 400);
    }
    if (!Array.isArray(payload.accounts) || !Array.isArray(payload.cards) || !Array.isArray(payload.transactions)) {
      throw new AppError(
        ErrorCodes.IMPORT_INVALID_PAYLOAD,
        'Payload deve conter as listas accounts, cards e transactions (formato real do slice local do MVP).',
        400,
      );
    }
    const payments = Array.isArray(payload.payments) ? payload.payments : [];

    const raw = JSON.stringify(payload);
    const checksum = createHash('sha256').update(raw).digest('hex');

    const existingBatch = this.db
      .prepare('SELECT * FROM import_batches WHERE space_id = ? AND checksum = ?')
      .get(authContext.spaceId, checksum);
    if (existingBatch) {
      return {
        batchId: existingBatch.id,
        duplicate: true,
        importedAccounts: existingBatch.imported_accounts,
        importedCards: existingBatch.imported_cards,
        importedCategories: existingBatch.imported_categories,
        importedTransactions: existingBatch.imported_transactions,
        importedPayments: existingBatch.imported_payments,
        skipped: existingBatch.skipped_count,
      };
    }

    const batchId = randomUUID();
    const accountIdMap = new Map(); // id local do MVP -> id real
    const cardIdMap = new Map();
    const categoryCache = new Map();
    let importedAccounts = 0;
    let importedCards = 0;
    let importedCategories = 0;
    let importedTransactions = 0;
    let importedPayments = 0;
    let skipped = 0;

    return this._runAtomic(() => {
      // O lote é criado ANTES das entidades para satisfazer a FK de import_entities.batch_id;
      // os contadores finais são atualizados ao término do processamento.
      this.db
        .prepare(
          `INSERT INTO import_batches (
            id, space_id, source, checksum, raw_payload, status,
            imported_accounts, imported_cards, imported_categories, imported_transactions, imported_payments, skipped_count
          ) VALUES (?, ?, ?, ?, ?, 'completed', 0, 0, 0, 0, 0, 0)`,
        )
        .run(batchId, authContext.spaceId, payload.source || 'localstorage_mvp', checksum, raw);

      const trackEntity = this.db.prepare(
        'INSERT INTO import_entities (id, space_id, batch_id, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)',
      );

      // 1. Contas
      for (const acc of payload.accounts) {
        if (!acc || !acc.id || !acc.name || typeof acc.balance !== 'number') {
          skipped += 1;
          continue;
        }
        const created = this.createAccount(authContext, {
          name: acc.name,
          openingBalance: Math.round(acc.balance),
          accountType: acc.type || 'checking',
        });
        accountIdMap.set(acc.id, created.id);
        trackEntity.run(randomUUID(), authContext.spaceId, batchId, 'accounts', created.id);
        importedAccounts += 1;
      }

      // 2. Cartões (paymentAccountId, quando presente, precisa resolver dentro do lote)
      for (const card of payload.cards) {
        const closingDay = Number(card?.closingDay);
        const dueDay = Number(card?.dueDay);
        const validDays = Number.isInteger(closingDay) && closingDay >= 1 && closingDay <= 31
          && Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31;
        if (!card || !card.id || !card.name || !validDays) {
          skipped += 1;
          continue;
        }
        if (card.paymentAccountId && !accountIdMap.has(card.paymentAccountId)) {
          skipped += 1; // referência a conta não resolvida dentro do próprio lote
          continue;
        }
        const created = this.createCreditCard(authContext, {
          name: card.name,
          brand: card.brand || null,
          closingDay,
          dueDay,
          creditLimit: typeof card.creditLimit === 'number' ? Math.round(card.creditLimit) : null,
          paymentAccountId: card.paymentAccountId ? accountIdMap.get(card.paymentAccountId) : null,
        });
        cardIdMap.set(card.id, created.id);
        trackEntity.run(randomUUID(), authContext.spaceId, batchId, 'credit_cards', created.id);
        importedCards += 1;
      }

      // 3. Transações (categoria resolvida/criada por nome; card_payment é pulado de
      //    propósito — ver nota de topo — e nunca conta como inválido/skipped)
      for (const tx of payload.transactions) {
        if (!tx || !tx.id || !tx.type || !tx.description || typeof tx.amount !== 'number' || !tx.transactionDate) {
          skipped += 1;
          continue;
        }

        if (tx.type === 'card_payment') {
          continue;
        }

        const categoryKind = tx.type === 'income' ? 'income' : 'expense';
        let categoryId = null;
        if (tx.category) {
          const resolved = this._resolveOrCreateCategoryByName(authContext, tx.category, categoryKind, categoryCache);
          categoryId = resolved.id;
          if (resolved.created) {
            trackEntity.run(randomUUID(), authContext.spaceId, batchId, 'categories', resolved.id);
            importedCategories += 1;
          }
        }

        if (tx.type === 'expense' || tx.type === 'income') {
          const accountId = tx.accountId ? accountIdMap.get(tx.accountId) : null;
          if (tx.accountId && !accountId) {
            skipped += 1;
            continue;
          }
          const created = this.createTransaction(authContext, {
            type: tx.type,
            description: tx.description,
            amount: Math.round(tx.amount),
            accountId,
            categoryId,
            transactionDate: tx.transactionDate,
          });
          trackEntity.run(randomUUID(), authContext.spaceId, batchId, 'transactions', created.id);
          importedTransactions += 1;
          continue;
        }

        if (tx.type === 'card_purchase' || tx.type === 'refund') {
          const creditCardId = tx.creditCardId ? cardIdMap.get(tx.creditCardId) : null;
          if (!creditCardId) {
            skipped += 1; // compra/estorno de cartão sem cartão resolvido no lote
            continue;
          }
          const created = this.createCardTransaction(authContext, {
            type: tx.type,
            creditCardId,
            amount: Math.round(tx.amount),
            description: tx.description,
            categoryId,
            transactionDate: tx.transactionDate,
          });
          trackEntity.run(randomUUID(), authContext.spaceId, batchId, 'transactions', created.id);
          importedTransactions += 1;
          continue;
        }

        skipped += 1; // tipo desconhecido: nunca inventa comportamento para ele
      }

      // 4. Pagamentos de fatura (fonte de verdade do evento de caixa — ver nota de topo)
      for (const payment of payments) {
        if (
          !payment || !payment.invoiceId || !payment.fromAccountId
          || typeof payment.amount !== 'number' || payment.amount <= 0 || !payment.paymentDate
        ) {
          skipped += 1;
          continue;
        }

        const accountId = accountIdMap.get(payment.fromAccountId);
        if (!accountId) {
          skipped += 1;
          continue;
        }

        // payment.invoiceId = `${card.id}-${closingDateISO}` no formato real do MVP.
        const cardLocalEntry = payload.cards.find(
          (card) => card?.id && payment.invoiceId.startsWith(`${card.id}-`),
        );
        const realCardId = cardLocalEntry ? cardIdMap.get(cardLocalEntry.id) : null;
        if (!realCardId) {
          skipped += 1;
          continue;
        }

        const closingDateFragment = payment.invoiceId.slice(cardLocalEntry.id.length + 1);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(closingDateFragment)) {
          skipped += 1;
          continue;
        }

        const invoice = this.getOrCreateOpenInvoice(authContext, realCardId, closingDateFragment);
        const result = this.registerInvoicePayment(authContext, {
          invoiceId: invoice.id,
          amount: Math.round(payment.amount),
          paymentDate: payment.paymentDate,
          accountId,
        });

        if (!result.duplicate) {
          const paymentRow = this.db
            .prepare('SELECT transaction_id FROM invoice_payments WHERE id = ?')
            .get(result.paymentId);
          if (paymentRow?.transaction_id) {
            trackEntity.run(randomUUID(), authContext.spaceId, batchId, 'transactions', paymentRow.transaction_id);
          }
          importedPayments += 1;
        }
      }

      this.db
        .prepare(
          `UPDATE import_batches
           SET imported_accounts = ?, imported_cards = ?, imported_categories = ?,
               imported_transactions = ?, imported_payments = ?, skipped_count = ?
           WHERE id = ?`,
        )
        .run(importedAccounts, importedCards, importedCategories, importedTransactions, importedPayments, skipped, batchId);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'import.create',
        entityType: 'import_batches',
        entityId: batchId,
        newData: { importedAccounts, importedCards, importedCategories, importedTransactions, importedPayments, skipped },
      });

      return {
        batchId,
        duplicate: false,
        importedAccounts,
        importedCards,
        importedCategories,
        importedTransactions,
        importedPayments,
        skipped,
      };
    });
  }

  getImportBatch(authContext, batchId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM import_batches WHERE id = ? AND space_id = ?')
      .get(batchId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Lote de importação não encontrado.', 404);
    }
    return row;
  }

  /**
   * Reverte um lote de importação já concluído, arquivando/excluindo
   * logicamente somente as entidades criadas por ele (rastreadas em
   * import_entities), sem tocar em dados de outras origens.
   */
  reverseImportBatch(authContext, { batchId }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const batch = this.getImportBatch(authContext, batchId);
    if (batch.status === 'reversed') {
      return { batchId, alreadyReversed: true, entitiesCount: 0 };
    }

    const entities = this.db
      .prepare('SELECT * FROM import_entities WHERE batch_id = ? AND space_id = ?')
      .all(batchId, authContext.spaceId);

    return this._runAtomic(() => {
      const affectedAccountIds = new Set();

      for (const entity of entities) {
        if (entity.entity_type === 'transactions') {
          // Captura a conta afetada ANTES do soft-delete para poder recalcular
          // o saldo depois, sem depender de um valor já apagado logicamente.
          const tx = this.db
            .prepare('SELECT account_id FROM transactions WHERE id = ? AND space_id = ?')
            .get(entity.entity_id, authContext.spaceId);
          if (tx?.account_id) affectedAccountIds.add(tx.account_id);

          this.db
            .prepare("UPDATE transactions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
            .run(entity.entity_id, authContext.spaceId);
        } else if (entity.entity_type === 'accounts') {
          this.db
            .prepare("UPDATE accounts SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
            .run(entity.entity_id, authContext.spaceId);
        } else if (entity.entity_type === 'categories') {
          this.db
            .prepare("UPDATE categories SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
            .run(entity.entity_id, authContext.spaceId);
        } else if (entity.entity_type === 'credit_cards') {
          this.db
            .prepare("UPDATE credit_cards SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?")
            .run(entity.entity_id, authContext.spaceId);
        }
      }

      for (const accountId of affectedAccountIds) {
        this._recalculateAccountBalance(authContext.spaceId, accountId);
      }

      this.db.prepare("UPDATE import_batches SET status = 'reversed', reversed_at = datetime('now') WHERE id = ?").run(batchId);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'import.reverse',
        entityType: 'import_batches',
        entityId: batchId,
        newData: { entitiesCount: entities.length },
      });

      return { batchId, reversed: true, entitiesCount: entities.length };
    });
  }

  // =========================================================================
  // ATRIBUTOS PERSONALIZADOS VERSIONADOS (ECO-61 EXTENSÃO)
  // =========================================================================

  createAttributeDefinition(
    authContext,
    {
      id = randomUUID(),
      targetType,
      categoryId = null,
      name,
      slug,
      dataType,
      isMultiple = false,
      isRequired = false,
      allowedOptions = null,
    },
  ) {
    requireAuthorization(authContext, Permissions.ATTRIBUTE_DEFINITIONS_MANAGE);

    if (categoryId) {
      const cat = this.db.prepare('SELECT space_id FROM categories WHERE id = ?').get(categoryId);
      if (!cat || cat.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Categoria do atributo pertence a outro espaço ou não existe.',
          403,
        );
      }
    }

    const validTypes = ['text', 'number', 'currency', 'date', 'boolean', 'select', 'barcode'];
    if (!validTypes.includes(dataType)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Tipo de dado '${dataType}' inválido.`);
    }

    this.db
      .prepare(
        `INSERT INTO attribute_definitions (
          id, space_id, target_type, category_id, name, slug, data_type,
          is_multiple, is_required, allowed_options, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        authContext.spaceId,
        targetType,
        categoryId,
        name,
        slug,
        dataType,
        isMultiple ? 1 : 0,
        isRequired ? 1 : 0,
        allowedOptions ? JSON.stringify(allowedOptions) : null,
      );

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'attribute_definition.create',
      entityType: 'attribute_definitions',
      entityId: id,
      newData: { name, slug, dataType, version: 1 },
    });

    return this.getAttributeDefinition(authContext, id);
  }

  getAttributeDefinition(authContext, definitionId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM attribute_definitions WHERE id = ? AND space_id = ?')
      .get(definitionId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Definição de atributo não encontrada.', 404);
    }
    return row;
  }

  /**
   * Atualização com versionamento:
   * - Renomear preserva histórico e mantém a mesma versão.
   * - Mudar tipo de dado cria uma NOVA versão (version + 1), mantendo a versão anterior para auditoria.
   */
  updateAttributeDefinition(
    authContext,
    definitionId,
    { name = null, dataType = null, allowedOptions = null, isRequired = null },
  ) {
    requireAuthorization(authContext, Permissions.ATTRIBUTE_DEFINITIONS_MANAGE);
    const current = this.getAttributeDefinition(authContext, definitionId);

    if (current.archived_at) {
      throw new AppError(ErrorCodes.ATTRIBUTE_ARCHIVED, 'Atributo arquivado não pode ser alterado.', 400);
    }

    if (dataType && dataType !== current.data_type) {
      // Mudança de tipo cria uma nova versão
      const newVersionId = randomUUID();
      const newVersion = current.version + 1;

      this.db.exec('BEGIN TRANSACTION;');
      try {
        // Arquiva versão anterior para novos usos
        this.db
          .prepare("UPDATE attribute_definitions SET archived_at = datetime('now') WHERE id = ?")
          .run(current.id);

        this.db
          .prepare(
            `INSERT INTO attribute_definitions (
              id, space_id, target_type, category_id, name, slug, data_type,
              is_multiple, is_required, allowed_options, version, previous_version_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newVersionId,
            authContext.spaceId,
            current.target_type,
            current.category_id,
            name || current.name,
            current.slug,
            dataType,
            current.is_multiple,
            isRequired !== null ? (isRequired ? 1 : 0) : current.is_required,
            allowedOptions ? JSON.stringify(allowedOptions) : current.allowed_options,
            newVersion,
            current.id,
          );

        this.logAudit({
          spaceId: authContext.spaceId,
          actorUserId: authContext.userId,
          action: 'attribute_definition.new_version',
          entityType: 'attribute_definitions',
          entityId: newVersionId,
          oldData: { id: current.id, dataType: current.data_type, version: current.version },
          newData: { id: newVersionId, dataType, version: newVersion },
        });

        this.db.exec('COMMIT;');
        return this.getAttributeDefinition(authContext, newVersionId);
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      }
    }

    // Apenas renomeação ou ajuste de opções na mesma versão
    this.db
      .prepare(
        `UPDATE attribute_definitions SET
          name = COALESCE(?, name),
          allowed_options = COALESCE(?, allowed_options),
          is_required = COALESCE(?, is_required),
          updated_at = datetime('now')
         WHERE id = ? AND space_id = ?`,
      )
      .run(
        name,
        allowedOptions ? JSON.stringify(allowedOptions) : null,
        isRequired !== null ? (isRequired ? 1 : 0) : null,
        definitionId,
        authContext.spaceId,
      );

    return this.getAttributeDefinition(authContext, definitionId);
  }

  archiveAttributeDefinition(authContext, definitionId) {
    requireAuthorization(authContext, Permissions.ATTRIBUTE_DEFINITIONS_MANAGE);
    const current = this.getAttributeDefinition(authContext, definitionId);

    this.db
      .prepare("UPDATE attribute_definitions SET archived_at = datetime('now') WHERE id = ?")
      .run(current.id);

    return { ok: true, status: 'archived' };
  }

  setAttributeValues(authContext, { entityType, entityId, values }) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);

    for (const item of values) {
      const def = this.getAttributeDefinition(authContext, item.definitionId);
      if (def.archived_at) {
        throw new AppError(
          ErrorCodes.ATTRIBUTE_ARCHIVED,
          `Atributo '${def.name}' está arquivado e impede novos usos.`,
          400,
        );
      }

      const valId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO attribute_values (
            id, space_id, attribute_definition_id, entity_type, entity_id,
            value_text, value_number, value_integer, value_boolean, value_date, value_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          valId,
          authContext.spaceId,
          def.id,
          entityType,
          entityId,
          item.text || null,
          item.number !== undefined ? item.number : null,
          item.integer !== undefined ? item.integer : null,
          item.boolean !== undefined ? (item.boolean ? 1 : 0) : null,
          item.date || null,
          item.json ? JSON.stringify(item.json) : null,
        );
    }
  }

  getAttributeValues(authContext, { entityType, entityId }) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.db
      .prepare(
        `SELECT v.*, d.name as attribute_name, d.slug as attribute_slug, d.data_type
         FROM attribute_values v
         JOIN attribute_definitions d ON d.id = v.attribute_definition_id
         WHERE v.space_id = ? AND v.entity_type = ? AND v.entity_id = ?`,
      )
      .all(authContext.spaceId, entityType, entityId);
  }

  // =========================================================================
  // LOCAIS DE COMPRA (PURCHASE LOCATIONS)
  // =========================================================================

  createPurchaseLocation(authContext, { id = randomUUID(), brandName, branchName = null, address = null, city = null }) {
    requireAuthorization(authContext, Permissions.LOCATIONS_WRITE);

    this.db
      .prepare(
        'INSERT INTO purchase_locations (id, space_id, brand_name, branch_name, address, city) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, authContext.spaceId, brandName, branchName, address, city);

    return this.getPurchaseLocation(authContext, id);
  }

  getPurchaseLocation(authContext, locationId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM purchase_locations WHERE id = ? AND space_id = ?')
      .get(locationId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Local de compra não encontrado.', 404);
    }
    return row;
  }

  listPurchaseLocations(authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.db
      .prepare('SELECT * FROM purchase_locations WHERE space_id = ? AND archived_at IS NULL ORDER BY brand_name ASC')
      .all(authContext.spaceId);
  }

  // =========================================================================
  // PRODUTOS DE CATÁLOGO (IDENTIFICADOS POR BARCODE OU NORMALIZAÇÃO)
  // =========================================================================

  createProduct(
    authContext,
    {
      id = randomUUID(),
      name,
      barcode = null,
      brand = null,
      defaultUnit = 'un',
      defaultCategoryId = null,
    },
  ) {
    requireAuthorization(authContext, Permissions.PRODUCTS_WRITE);

    if (defaultCategoryId) {
      const cat = this.db.prepare('SELECT space_id FROM categories WHERE id = ?').get(defaultCategoryId);
      if (!cat || cat.space_id !== authContext.spaceId) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Categoria padrão pertence a outro espaço.', 403);
      }
    }

    if (barcode) {
      const existing = this.db
        .prepare('SELECT id FROM products WHERE space_id = ? AND barcode = ?')
        .get(authContext.spaceId, barcode);
      if (existing) {
        throw new AppError(
          ErrorCodes.BARCODE_CONFLICT,
          `Conflito: código de barras '${barcode}' já está cadastrado para outro produto neste espaço.`,
          400,
        );
      }
    }

    const normalizedName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    this.db
      .prepare(
        `INSERT INTO products (id, space_id, name, normalized_name, barcode, brand, default_unit, default_category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, authContext.spaceId, name, normalizedName, barcode, brand, defaultUnit, defaultCategoryId);

    return this.getProduct(authContext, id);
  }

  getProduct(authContext, productId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM products WHERE id = ? AND space_id = ?')
      .get(productId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Produto não encontrado.', 404);
    }
    return row;
  }

  getProductByBarcode(authContext, barcode) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return (
      this.db
        .prepare('SELECT * FROM products WHERE space_id = ? AND barcode = ?')
        .get(authContext.spaceId, barcode) || null
    );
  }

  mergeProducts(authContext, { sourceProductId, targetProductId }) {
    requireAuthorization(authContext, Permissions.PRODUCTS_MERGE);

    const source = this.getProduct(authContext, sourceProductId);
    const target = this.getProduct(authContext, targetProductId);

    // Conflitos de barcode bloqueiam fusão
    if (source.barcode && target.barcode && source.barcode !== target.barcode) {
      throw new AppError(
        ErrorCodes.BARCODE_CONFLICT,
        'Não é possível fundir produtos com códigos de barras distintos.',
        400,
      );
    }

    this.db.exec('BEGIN TRANSACTION;');
    try {
      // Reatribui itens de compras e histórico de preços para o produto alvo
      this.db
        .prepare('UPDATE purchase_items SET product_id = ? WHERE product_id = ? AND space_id = ?')
        .run(target.id, source.id, authContext.spaceId);

      this.db
        .prepare('UPDATE price_history SET product_id = ? WHERE product_id = ? AND space_id = ?')
        .run(target.id, source.id, authContext.spaceId);

      // Remove o produto fonte
      this.db.prepare('DELETE FROM products WHERE id = ?').run(source.id);

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'products.merge',
        entityType: 'products',
        entityId: target.id,
        oldData: { sourceId: source.id, sourceName: source.name },
        newData: { targetId: target.id, targetName: target.name },
      });

      this.db.exec('COMMIT;');
      return this.getProduct(authContext, target.id);
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  // =========================================================================
  // COMPRA-PAI COM ITENS-FILHOS (CRIAÇÃO ATÔMICA, SOMA EXATA, QUANTIDADES DECIMAIS)
  // =========================================================================

  createPurchaseWithItems(
    authContext,
    {
      purchaseId = randomUUID(),
      transactionId = randomUUID(),
      accountId = null,
      creditCardId = null,
      locationId = null,
      transactionDate,
      description,
      notes = null,
      discountAmount = 0,
      additionAmount = 0,
      items, // array de itens
    },
  ) {
    requireAuthorization(authContext, Permissions.PURCHASES_WRITE);

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'A compra deve possuir ao menos um item.', 400);
    }

    if (locationId) {
      const loc = this.db.prepare('SELECT space_id FROM purchase_locations WHERE id = ?').get(locationId);
      if (!loc || loc.space_id !== authContext.spaceId) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Local pertence a outro espaço.', 403);
      }
    }

    // Validação e cálculo da soma exata dos itens
    let calculatedSubtotal = 0;
    const processedItems = [];

    for (const item of items) {
      const itemId = item.id || randomUUID();

      // Checa categoria do item (cada item pode ter categoria diferente!)
      const cat = this.db.prepare('SELECT space_id FROM categories WHERE id = ?').get(item.categoryId);
      if (!cat || cat.space_id !== authContext.spaceId) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Categoria do item pertence a outro espaço.', 403);
      }

      // Preço bruto: quantidade * unitPrice em centavos (arredondado)
      const itemGross = item.totalGrossAmount !== undefined
        ? item.totalGrossAmount
        : Math.round(item.quantity * item.unitPrice);

      const itemDiscount = item.discountAmount || 0;
      const itemNet = item.totalNetAmount !== undefined
        ? item.totalNetAmount
        : Math.max(0, itemGross - itemDiscount);

      calculatedSubtotal += itemGross;

      processedItems.push({
        id: itemId,
        productId: item.productId || null,
        categoryId: item.categoryId,
        description: item.description,
        barcode: item.barcode || null,
        quantity: item.quantity,
        unit: item.unit || 'un',
        unitPrice: item.unitPrice,
        discountAmount: itemDiscount,
        totalGrossAmount: itemGross,
        totalNetAmount: itemNet,
      });
    }

    const netAmount = calculatedSubtotal - discountAmount + additionAmount;
    if (netAmount < 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Valor líquido da compra não pode ser negativo.', 400);
    }

    this.db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Cria a transação financeira pai
      this.createTransaction(authContext, {
        id: transactionId,
        type: 'expense',
        description,
        amount: netAmount,
        accountId,
        creditCardId,
        transactionDate,
        observation: notes,
      });

      // 2. Cria o registro da compra pai
      this.db
        .prepare(
          `INSERT INTO purchases (
            id, space_id, transaction_id, location_id, notes,
            subtotal_amount, discount_amount, addition_amount, net_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          purchaseId,
          authContext.spaceId,
          transactionId,
          locationId,
          notes,
          calculatedSubtotal,
          discountAmount,
          additionAmount,
          netAmount,
        );

      // 3. Insere os itens-filhos e registra histórico de preço efetivo
      const insertItemStmt = this.db.prepare(
        `INSERT INTO purchase_items (
          id, space_id, purchase_id, product_id, category_id, description, barcode,
          quantity, unit, unit_price, discount_amount, total_gross_amount, total_net_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const insertPriceStmt = this.db.prepare(
        `INSERT INTO price_history (
          id, space_id, product_id, purchase_item_id, location_id, date,
          quantity, unit, unit_price_effective, currency, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BRL', 'purchase')`,
      );

      for (const pi of processedItems) {
        insertItemStmt.run(
          pi.id,
          authContext.spaceId,
          purchaseId,
          pi.productId,
          pi.categoryId,
          pi.description,
          pi.barcode,
          pi.quantity,
          pi.unit,
          pi.unitPrice,
          pi.discountAmount,
          pi.totalGrossAmount,
          pi.totalNetAmount,
        );

        // Se tiver produto associado, alimenta o histórico auditável de preços
        if (pi.productId) {
          const effectiveUnitPrice = Math.round(pi.totalNetAmount / pi.quantity);
          insertPriceStmt.run(
            randomUUID(),
            authContext.spaceId,
            pi.productId,
            pi.id,
            locationId,
            transactionDate,
            pi.quantity,
            pi.unit,
            effectiveUnitPrice,
          );
        }
      }

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'purchase.create',
        entityType: 'purchases',
        entityId: purchaseId,
        newData: { netAmount, itemsCount: processedItems.length },
      });

      this.db.exec('COMMIT;');
      return this.getPurchase(authContext, purchaseId);
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  getPurchase(authContext, purchaseId) {
    requireAuthorization(authContext, Permissions.PURCHASES_READ);
    const purchase = this.db
      .prepare('SELECT * FROM purchases WHERE id = ? AND space_id = ?')
      .get(purchaseId, authContext.spaceId);
    if (!purchase) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Compra não encontrada.', 404);
    }

    const items = this.db
      .prepare(
        `SELECT pi.*, c.name as category_name, p.name as product_name
         FROM purchase_items pi
         JOIN categories c ON c.id = pi.category_id
         LEFT JOIN products p ON p.id = pi.product_id
         WHERE pi.purchase_id = ? AND pi.space_id = ?`,
      )
      .all(purchaseId, authContext.spaceId);

    return {
      ...purchase,
      items,
    };
  }

  // =========================================================================
  // DEVOLUÇÕES E ESTORNOS DE ITENS VINCULADOS
  // =========================================================================

  createItemRefund(
    authContext,
    {
      id = randomUUID(),
      purchaseItemId,
      refundQuantity,
      refundAmount,
      reason = null,
      refundDate,
      createRefundTransaction = true,
      accountId = null,
    },
  ) {
    requireAuthorization(authContext, Permissions.REFUNDS_WRITE);

    const item = this.db
      .prepare('SELECT * FROM purchase_items WHERE id = ? AND space_id = ?')
      .get(purchaseItemId, authContext.spaceId);
    if (!item) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Item de compra não encontrado.', 404);
    }

    // Calcula devoluções já efetuadas para o item
    const existingRefunds = this.db
      .prepare(
        'SELECT SUM(refund_quantity) as total_qty, SUM(refund_amount) as total_amt FROM item_refunds WHERE purchase_item_id = ?',
      )
      .get(purchaseItemId);

    const alreadyRefundedQty = existingRefunds?.total_qty || 0;
    const alreadyRefundedAmt = existingRefunds?.total_amt || 0;

    if (alreadyRefundedQty + refundQuantity > item.quantity) {
      throw new AppError(
        ErrorCodes.REFUND_EXCEEDS_QUANTITY,
        `Quantidade de devolução (${alreadyRefundedQty + refundQuantity}) excede a quantidade comprada (${item.quantity}).`,
        400,
      );
    }

    if (alreadyRefundedAmt + refundAmount > item.total_net_amount) {
      throw new AppError(
        ErrorCodes.REFUND_EXCEEDS_AMOUNT,
        `Valor da devolução (${alreadyRefundedAmt + refundAmount}) excede o valor líquido do item (${item.total_net_amount}).`,
        400,
      );
    }

    let refundTransactionId = null;

    this.db.exec('BEGIN TRANSACTION;');
    try {
      if (createRefundTransaction) {
        refundTransactionId = randomUUID();
        this.createTransaction(authContext, {
          id: refundTransactionId,
          type: 'refund',
          description: `Estorno item: ${item.description}`,
          amount: refundAmount,
          accountId,
          categoryId: item.category_id,
          transactionDate: refundDate,
        });
      }

      this.db
        .prepare(
          `INSERT INTO item_refunds (
            id, space_id, purchase_item_id, refund_transaction_id,
            refund_quantity, refund_amount, reason, refund_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          authContext.spaceId,
          purchaseItemId,
          refundTransactionId,
          refundQuantity,
          refundAmount,
          reason,
          refundDate,
        );

      this.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'item_refund.create',
        entityType: 'item_refunds',
        entityId: id,
        newData: { purchaseItemId, refundQuantity, refundAmount },
      });

      this.db.exec('COMMIT;');
      return this.getItemRefundSummary(authContext, purchaseItemId);
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  getItemRefundSummary(authContext, purchaseItemId) {
    requireAuthorization(authContext, Permissions.PURCHASES_READ);
    const item = this.db
      .prepare('SELECT * FROM purchase_items WHERE id = ? AND space_id = ?')
      .get(purchaseItemId, authContext.spaceId);
    if (!item) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Item não encontrado.', 404);
    }

    const refunds = this.db
      .prepare('SELECT * FROM item_refunds WHERE purchase_item_id = ? ORDER BY refund_date DESC')
      .all(purchaseItemId);

    const totalRefundedAmount = refunds.reduce((sum, r) => sum + r.refund_amount, 0);
    const totalRefundedQuantity = refunds.reduce((sum, r) => sum + r.refund_quantity, 0);

    return {
      itemId: item.id,
      description: item.description,
      grossAmount: item.total_gross_amount,
      originalNetAmount: item.total_net_amount,
      totalRefundedAmount,
      totalRefundedQuantity,
      netAmountAfterRefunds: item.total_net_amount - totalRefundedAmount,
      refunds,
    };
  }

  // =========================================================================
  // HISTÓRICO DE PREÇOS AUDITÁVEL
  // =========================================================================

  getPriceHistory(authContext, { productId, locationId = null }) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);

    let query = `
      SELECT ph.*, pl.brand_name, pl.branch_name, p.name as product_name
      FROM price_history ph
      JOIN products p ON p.id = ph.product_id
      LEFT JOIN purchase_locations pl ON pl.id = ph.location_id
      WHERE ph.space_id = ? AND ph.product_id = ?
    `;
    const params = [authContext.spaceId, productId];

    if (locationId) {
      query += ' AND ph.location_id = ?';
      params.push(locationId);
    }

    query += ' ORDER BY ph.date DESC, ph.created_at DESC';
    return this.db.prepare(query).all(...params);
  }

  // =========================================================================
  // METAS FINANCEIRAS E COFRINHOS (ECO-66 S4.1)
  // =========================================================================

  _getGoal(authContext, goalId) {
    const goal = this.db.prepare('SELECT * FROM goals WHERE id = ? AND space_id = ? AND deleted_at IS NULL').get(goalId, authContext.spaceId);
    if (!goal) throw new AppError(ErrorCodes.NOT_FOUND, 'Meta não encontrada.', 404);
    return goal;
  }

  _assertGoalCategory(spaceId, categoryId) {
    const category = this.db.prepare("SELECT id FROM categories WHERE id = ? AND space_id = ? AND kind = 'expense' AND archived_at IS NULL").get(categoryId, spaceId);
    if (!category) throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Categoria de despesa não encontrada no espaço.', 403);
  }

  createGoal(authContext, { name, goalType, targetAmount, categoryId = null, startDate, deadline, recurrenceRule = null }) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    if (!name || !['savings', 'spending'].includes(goalType) || !(targetAmount > 0) || !startDate || !deadline || deadline < startDate) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Dados da meta inválidos.', 400);
    }
    if (goalType === 'spending' && !categoryId) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Meta de gasto exige category_id.', 400);
    if (categoryId) this._assertGoalCategory(authContext.spaceId, categoryId);

    return this._runAtomic(() => {
      const id = randomUUID();
      this.db.prepare(`INSERT INTO goals (id, space_id, name, goal_type, target_amount, category_id, start_date, deadline, recurrence_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, authContext.spaceId, name, goalType, targetAmount, categoryId, startDate, deadline, recurrenceRule);
      let piggyBank = null;
      if (goalType === 'savings') {
        const accountId = randomUUID();
        this.db.prepare(`INSERT INTO accounts (id, space_id, name, account_type, opening_balance, current_balance, is_piggy_bank) VALUES (?, ?, ?, 'savings', 0, 0, 1)`)
          .run(accountId, authContext.spaceId, `Cofrinho: ${name}`);
        const piggyId = randomUUID();
        this.db.prepare('INSERT INTO piggy_banks (id, space_id, goal_id, account_id) VALUES (?, ?, ?, ?)').run(piggyId, authContext.spaceId, id, accountId);
        piggyBank = { id: piggyId, accountId };
      }
      this.logAudit({ spaceId: authContext.spaceId, actorUserId: authContext.userId, action: 'goal.create', entityType: 'goals', entityId: id, newData: { name, goalType, targetAmount, categoryId, piggyBank } });
      return this.getGoalProgress(authContext, id);
    });
  }

  updateGoal(authContext, goalId, updates = {}) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    const existing = this._getGoal(authContext, goalId);
    const targetAmount = updates.targetAmount ?? existing.target_amount;
    const startDate = updates.startDate ?? existing.start_date;
    const deadline = updates.deadline ?? existing.deadline;
    const categoryId = updates.categoryId ?? existing.category_id;
    if (!(targetAmount > 0) || deadline < startDate || (existing.goal_type === 'spending' && !categoryId)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Atualização de meta inválida.', 400);
    if (categoryId) this._assertGoalCategory(authContext.spaceId, categoryId);
    const fields = { name: updates.name ?? existing.name, target_amount: targetAmount, category_id: categoryId, start_date: startDate, deadline, recurrence_rule: updates.recurrenceRule ?? existing.recurrence_rule };
    this._runAtomic(() => {
      this.db.prepare("UPDATE goals SET name = ?, target_amount = ?, category_id = ?, start_date = ?, deadline = ?, recurrence_rule = ?, updated_at = datetime('now') WHERE id = ? AND space_id = ?")
        .run(fields.name, fields.target_amount, fields.category_id, fields.start_date, fields.deadline, fields.recurrence_rule, goalId, authContext.spaceId);
      this.logAudit({ spaceId: authContext.spaceId, actorUserId: authContext.userId, action: 'goal.update', entityType: 'goals', entityId: goalId, oldData: existing, newData: fields });
    });
    return this.getGoalProgress(authContext, goalId);
  }

  deleteGoal(authContext, goalId) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    const existing = this._getGoal(authContext, goalId);
    this._runAtomic(() => {
      if (existing.goal_type === 'savings') {
        const piggyBank = this.db
          .prepare(
            `SELECT a.current_balance
             FROM piggy_banks pb
             JOIN accounts a ON a.id = pb.account_id
             WHERE pb.goal_id = ? AND pb.space_id = ?`,
          )
          .get(goalId, authContext.spaceId);

        if (!piggyBank || Number(piggyBank.current_balance) !== 0) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Não é possível excluir um cofrinho com saldo. Faça um saque até o saldo ficar zerado.', 400);
        }
      }

      this.db.prepare("UPDATE goals SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND space_id = ?").run(goalId, authContext.spaceId);
      this.logAudit({ spaceId: authContext.spaceId, actorUserId: authContext.userId, action: 'goal.delete', entityType: 'goals', entityId: goalId, oldData: existing });
    });
    return { deleted: true, id: goalId };
  }

  getGoalProgress(authContext, goalId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const goal = this._getGoal(authContext, goalId);
    let currentAmount = 0;
    let piggyBank = null;
    if (goal.goal_type === 'savings') {
      piggyBank = this.db.prepare(`SELECT pb.id, pb.account_id, a.current_balance FROM piggy_banks pb JOIN accounts a ON a.id = pb.account_id WHERE pb.goal_id = ? AND pb.space_id = ?`).get(goal.id, authContext.spaceId);
      currentAmount = piggyBank?.current_balance ?? 0;
    } else {
      currentAmount = this.db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE space_id = ? AND category_id = ? AND type IN ('expense', 'card_purchase') AND deleted_at IS NULL AND transaction_date >= ? AND transaction_date <= ?`).get(authContext.spaceId, goal.category_id, goal.start_date, goal.deadline).total;
    }
    return { ...goal, current_amount: currentAmount, progress_percent: Math.min(100, Math.round((currentAmount / goal.target_amount) * 10000) / 100), piggy_bank: piggyBank ? { id: piggyBank.id, account_id: piggyBank.account_id, balance: piggyBank.current_balance } : null };
  }

  listGoals(authContext, { limit = 50, offset = 0 } = {}) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const ids = this.db.prepare('SELECT id FROM goals WHERE space_id = ? AND deleted_at IS NULL ORDER BY deadline ASC, created_at DESC LIMIT ? OFFSET ?').all(authContext.spaceId, safeLimit, safeOffset);
    return ids.map(({ id }) => this.getGoalProgress(authContext, id));
  }

  movePiggyBankFunds(authContext, { goalId, otherAccountId, amount, date, direction, description }) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    if (!(amount > 0)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Valor do cofrinho deve ser positivo.', 400);
    const goal = this._getGoal(authContext, goalId);
    if (goal.goal_type !== 'savings') throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Apenas metas de poupança possuem cofrinho.', 400);
    const bank = this.db.prepare('SELECT pb.id, pb.account_id, a.current_balance FROM piggy_banks pb JOIN accounts a ON a.id = pb.account_id WHERE pb.goal_id = ? AND pb.space_id = ?').get(goalId, authContext.spaceId);
    const other = this.db.prepare('SELECT id, is_piggy_bank, current_balance FROM accounts WHERE id = ? AND space_id = ? AND archived_at IS NULL').get(otherAccountId, authContext.spaceId);
    if (!other || other.is_piggy_bank) throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Conta de origem ou destino inválida.', 403);
    if (direction === 'withdraw' && bank.current_balance < amount) throw new AppError(ErrorCodes.INSUFFICIENT_FUNDS, 'Saldo insuficiente no cofrinho.', 409);
    if (direction === 'deposit' && other.current_balance < amount) throw new AppError(ErrorCodes.INSUFFICIENT_FUNDS, 'Saldo insuficiente na conta de origem.', 409);
    const sourceAccountId = direction === 'deposit' ? other.id : bank.account_id;
    const destinationAccountId = direction === 'deposit' ? bank.account_id : other.id;
    const transfer = this.createTransfer(authContext, {
      sourceAccountId,
      destinationAccountId,
      amount,
      transferDate: date,
      description: description || (direction === 'deposit' ? `Aporte em ${goal.name}` : `Saque de ${goal.name}`),
      _allowPiggy: true,
      internalTransferToken: PIGGY_BANK_INTERNAL_TRANSFER,
    });
    this.logAudit({ spaceId: authContext.spaceId, actorUserId: authContext.userId, action: `piggy_bank.${direction}`, entityType: 'piggy_banks', entityId: bank.id, newData: { goalId, amount, transferId: transfer.id } });
    return { transfer, goal: this.getGoalProgress(authContext, goalId) };
  }

  // =========================================================================
  // CASHFLOW SANKEY DINÂMICO (ECO-64)
  //
  // Gera nodes e links para visualização Sankey do fluxo de caixa de um período.
  //
  // Regras invariantes:
  // 1. Transferências internas (type = 'transfer') não inflam entradas nem saídas.
  // 2. Previsões (recurrence_occurrences com status = 'forecast') não viram fatos:
  //    só transações com paid_status = 'paid' ou effective_date preenchido entram
  //    no caixa; compras no cartão (competência) entram na base de lançamento.
  // 3. Pagamento de fatura (type = 'card_payment') aparece no caixa como saída da
  //    conta pagadora; as compras individuais (type = 'card_purchase') entram na
  //    base de competência como despesas por categoria.
  // 4. Todos os valores são em centavos (inteiros).
  // 5. Nodes e links carregam metadados (ids dos lançamentos) para explicabilidade.
  //
  // Estrutura do retorno:
  //   { period, filters, basis, nodes: [{id, label, total}], links: [{source, target, value, transactions}] }
  //
  // Basis:
  //   'cash'    → só transações paid_status = 'paid' filtradas por effective_date (caixa)
  //   'accrual' → todas as transações (incluindo card_purchase) filtradas por transaction_date (competência)
  // =========================================================================

  getCashflowSankey(authContext, {
    startDate,
    endDate,
    basis = 'accrual',
    accountId = null,
    categoryId = null,
  } = {}) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);

    const today = new Date().toISOString().slice(0, 10);
    const resolvedStart = startDate || `${today.slice(0, 7)}-01`;
    const resolvedEnd = endDate || today;

    // Seleciona transações de acordo com a base
    let dateField;
    let paidFilter;
    if (basis === 'cash') {
      dateField = 'COALESCE(effective_date, transaction_date)';
      paidFilter = "AND paid_status = 'paid'";
    } else {
      dateField = 'transaction_date';
      paidFilter = '';
    }

    const params = [authContext.spaceId, resolvedStart, resolvedEnd];
    let extraFilter = '';
    if (accountId) {
      extraFilter += ' AND account_id = ?';
      params.push(accountId);
    }
    if (categoryId) {
      extraFilter += ' AND category_id = ?';
      params.push(categoryId);
    }

    // Exclui transferências (não inflam entradas/saídas) e registra compras de cartão em competência
    const rows = this.db
      .prepare(
        `SELECT t.id, t.type, t.amount, t.description,
                COALESCE(c.name, 'Sem categoria') as category_name,
                c.kind as category_kind,
                ${dateField} as ref_date
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.space_id = ?
           AND t.deleted_at IS NULL
           AND ${dateField} >= ? AND ${dateField} <= ?
           AND t.type NOT IN ('transfer')
           AND COALESCE(a.is_piggy_bank, 0) = 0
           ${paidFilter}
           ${extraFilter}
         ORDER BY t.type, category_name`,
      )
      .all(...params);

    // Nodes padrão
    const NODE_INCOME = 'node:income';
    const NODE_EXPENSE = 'node:expense';
    const NODE_CARD_PAYMENT = 'node:card_payment';

    const nodeMap = new Map();
    const ensureNode = (id, label) => {
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, label, total: 0 });
      }
      return nodeMap.get(id);
    };

    ensureNode(NODE_INCOME, 'Receitas');
    ensureNode(NODE_EXPENSE, 'Despesas');

    // Links: { sourceId -> targetId -> { value, transactionIds } }
    const linkIndex = new Map();
    const ensureLink = (sourceId, targetId) => {
      const key = `${sourceId}||${targetId}`;
      if (!linkIndex.has(key)) {
        linkIndex.set(key, { source: sourceId, target: targetId, value: 0, transactionIds: [] });
      }
      return linkIndex.get(key);
    };

    for (const row of rows) {
      const catNodeId = `cat:${row.category_name}`;

      if (row.type === 'income' || row.type === 'refund') {
        // Receita: categoria de receita → Receitas (nó central)
        const catNode = ensureNode(catNodeId, row.category_name);
        catNode.total += row.amount;
        nodeMap.get(NODE_INCOME).total += row.amount;
        const lnk = ensureLink(catNodeId, NODE_INCOME);
        lnk.value += row.amount;
        lnk.transactionIds.push(row.id);
      } else if (row.type === 'expense' || row.type === 'card_purchase') {
        // Despesa: Despesas → categoria de despesa
        const catNode = ensureNode(catNodeId, row.category_name);
        catNode.total += row.amount;
        nodeMap.get(NODE_EXPENSE).total += row.amount;
        const lnk = ensureLink(NODE_EXPENSE, catNodeId);
        lnk.value += row.amount;
        lnk.transactionIds.push(row.id);
      } else if (row.type === 'card_payment') {
        // Pagamento de fatura: Receitas → Pagamento de Fatura (saída de caixa real)
        const cpNode = ensureNode(NODE_CARD_PAYMENT, 'Pagamento de Fatura');
        cpNode.total += row.amount;
        nodeMap.get(NODE_INCOME).total += 0; // não inflam receitas
        nodeMap.get(NODE_EXPENSE).total += row.amount;
        const lnk = ensureLink(NODE_EXPENSE, NODE_CARD_PAYMENT);
        lnk.value += row.amount;
        lnk.transactionIds.push(row.id);
      }
    }

    // Link central: Receitas → Despesas (fluxo agregado)
    const incomeTotal = nodeMap.get(NODE_INCOME).total;
    const expenseTotal = nodeMap.get(NODE_EXPENSE).total;
    if (incomeTotal > 0 && expenseTotal > 0) {
      const centralLink = ensureLink(NODE_INCOME, NODE_EXPENSE);
      centralLink.value = Math.min(incomeTotal, expenseTotal);
    }

    // Remove nodes com total zero para não poluir o gráfico
    const nodes = [...nodeMap.values()].filter((n) => n.total > 0);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = [...linkIndex.values()].filter(
      (l) => l.value > 0 && nodeIds.has(l.source) && nodeIds.has(l.target),
    );

    return {
      period: { startDate: resolvedStart, endDate: resolvedEnd },
      filters: { accountId, categoryId },
      basis,
      nodes,
      links,
      summary: {
        totalIncome: incomeTotal,
        totalExpense: expenseTotal,
        netBalance: incomeTotal - expenseTotal,
      },
    };
  }
}
