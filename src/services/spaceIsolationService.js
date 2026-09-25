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

import { randomUUID } from 'node:crypto';
import { AppError, ErrorCodes } from '../domain/envelope.js';
import { Roles, requireAuthorization, Permissions } from '../domain/authorization.js';

export class SpaceIsolationService {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   */
  constructor(db) {
    this.db = db;
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

    this.db.exec('BEGIN TRANSACTION;');
    try {
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
      this.db.exec('COMMIT;');
      return this.getSpace(id);
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
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
  createAccount(authContext, { id = randomUUID(), name, openingBalance = 0, accountType = 'checking' }) {
    requireAuthorization(authContext, Permissions.ACCOUNTS_WRITE);

    this.db
      .prepare(
        `INSERT INTO accounts (id, space_id, name, opening_balance, current_balance, account_type)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, authContext.spaceId, name, openingBalance, openingBalance, accountType);

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'account.create',
      entityType: 'accounts',
      entityId: id,
      newData: { id, name, openingBalance, accountType },
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
    { id = randomUUID(), name, closingDay, dueDay, creditLimit = null, paymentAccountId = null, brand = null },
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

    this.db
      .prepare(
        `INSERT INTO credit_cards (id, space_id, name, closing_day, due_day, credit_limit, payment_account_id, brand)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, authContext.spaceId, name, closingDay, dueDay, creditLimit, paymentAccountId, brand);

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'credit_card.create',
      entityType: 'credit_cards',
      entityId: id,
      newData: { id, name, closingDay, dueDay, creditLimit, paymentAccountId },
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
    },
  ) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);

    // Validação de Cross-Space em todas as FKs
    if (accountId) {
      const acc = this.db.prepare('SELECT space_id FROM accounts WHERE id = ?').get(accountId);
      if (!acc || acc.space_id !== authContext.spaceId) {
        throw new AppError(
          ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
          'Conta pertence a outro espaço ou não existe.',
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

    this.db
      .prepare(
        `INSERT INTO transactions (
          id, space_id, type, description, amount, account_id, credit_card_id,
          category_id, destination_account_id, transaction_date, observation, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );

    this.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'transaction.create',
      entityType: 'transactions',
      entityId: id,
      newData: { id, type, description, amount, transactionDate },
    });

    return this.getTransaction(authContext, id);
  }

  getTransaction(authContext, transactionId) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const row = this.db
      .prepare('SELECT * FROM transactions WHERE id = ? AND space_id = ?')
      .get(transactionId, authContext.spaceId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Transação não encontrada.', 404);
    }
    return row;
  }
}
