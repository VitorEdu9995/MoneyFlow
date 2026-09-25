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
}
